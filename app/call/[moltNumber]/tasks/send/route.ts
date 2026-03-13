/**
 * POST /call/:moltNumber/tasks/send
 *
 * Send a task (call or text) to an agent.  A2A-native replacement for the
 * old /call and /text endpoints.
 *
 * Request body (A2A-style):
 * {
 *   "id": "optional-caller-task-id",
 *   "sessionId": "optional-session",
 *   "message": {
 *     "parts": [{ "type": "text", "text": "Hello" }]
 *   },
 *   "metadata": {
 *     "molt.intent": "call" | "text",
 *     "molt.caller": "SOLR-AAAA-BBBB-CCCC-DDDD"
 *   }
 * }
 *
 * MoltProtocol auth headers (required for non-public agents):
 *   x-molt-caller     — caller MoltNumber
 *   x-molt-timestamp  — unix timestamp
 *   x-molt-nonce      — random nonce
 *   x-molt-signature  — Ed25519 signature (base64url)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { validateWebhookUrl } from '@/lib/ssrf';
import { resolveForwarding, enforcePolicyAndAuth, enforceCallPolicy, isCallerBlocked, checkCarrierBlock } from '@/lib/services/task-routing';
import { checkCarrierPolicies } from '@/lib/services/carrier-policies';
import { getCircuitState, recordSuccess, recordFailure, scheduleRetry } from '@/lib/services/webhook-reliability';
import { sendPushNotification } from '@/lib/services/push-notifications';
import { calculateMessageCost, deductRelayCredits } from '@/lib/services/credits';
import { signDelivery, determineAttestation } from '@/lib/carrier-identity';
import { rateLimit, rateLimitKey, rateLimitPerTarget } from '@/lib/rate-limit';
import { moltErrorResponse } from '@/lib/errors';
import {
  MOLT_BAD_REQUEST,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
  MOLT_RATE_LIMITED,
  MOLT_OFFLINE,
  MOLT_BUSY,
  MOLT_DND,
  MOLT_FORWARDING_FAILED,
  MOLT_WEBHOOK_FAILED,
  MOLT_WEBHOOK_TIMEOUT,
} from '@moltprotocol/core';
import { lookupNumber, getCarrierDomain } from '@/lib/services/registry';
import { ensureCarrierRegistered } from '@/lib/carrier-boot';
import { MAX_TASKS_PER_AGENT } from '@/carrier.config';
import { randomUUID as cryptoRandomUUID } from 'crypto';
import { Prisma, TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';
import { z } from 'zod';

// Helper: cast typed parts to Prisma JSON
function asParts(parts: unknown): Prisma.InputJsonValue { return parts as Prisma.InputJsonValue; }

/**
 * Prune oldest completed/canceled tasks for an agent when the cap is exceeded.
 * Runs as fire-and-forget after task creation — non-blocking.
 * Uses a transaction so deletes are atomic (events → messages → tasks).
 */
async function pruneExcessTasks(agentId: string): Promise<void> {
  if (MAX_TASKS_PER_AGENT <= 0) return; // unlimited

  const count = await prisma.task.count({
    where: { OR: [{ calleeId: agentId }, { callerId: agentId }] },
  });
  if (count <= MAX_TASKS_PER_AGENT) return;

  const excess = count - MAX_TASKS_PER_AGENT;

  // Find the oldest completed/canceled tasks to prune
  const toDelete = await prisma.task.findMany({
    where: {
      OR: [{ calleeId: agentId }, { callerId: agentId }],
      status: { in: [TaskStatus.completed, TaskStatus.canceled, TaskStatus.failed] },
    },
    orderBy: { createdAt: 'asc' },
    take: excess,
    select: { id: true },
  });

  if (toDelete.length === 0) return;

  const ids = toDelete.map(t => t.id);

  // Delete events, messages, then tasks in a single transaction (FK order)
  await prisma.$transaction([
    prisma.taskEvent.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskMessage.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.task.deleteMany({ where: { id: { in: ids } } }),
  ]);
}

const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS || '30000', 10);

/** Maximum request body size (256 KB). Reject payloads larger than this before JSON parsing. */
const MAX_BODY_BYTES = parseInt(process.env.MAX_BODY_BYTES || '262144', 10); // 256 KB

const textPartSchema = z.object({ type: z.literal('text'), text: z.string().min(1) });
const dataPartSchema = z.object({ type: z.literal('data'), data: z.record(z.string(), z.unknown()) });
const filePartSchema = z.object({ type: z.literal('file'), mimeType: z.string().optional(), uri: z.string().optional(), bytes: z.string().optional() }).refine(d => d.uri || d.bytes, { message: 'file part requires uri or bytes' });
// Accept known part types strictly, pass through unknown types unchanged
const knownPartSchema = z.discriminatedUnion('type', [textPartSchema, dataPartSchema, filePartSchema]);
const unknownPartSchema = z.object({ type: z.string() }).passthrough();
const partSchema = z.union([knownPartSchema, unknownPartSchema]);

const bodySchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  message: z.object({
    parts: z.array(partSchema).min(1),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  // Lazy self-registration with the registry (no-op after first success)
  ensureCarrierRegistered().catch(() => {}); // fire-and-forget, don't block

  const callerKey = rateLimitKey(req);

  // Rate limit — burst + sustained (before any DB queries)
  const rl = await rateLimit(callerKey);
  if (!rl.ok) return moltErrorResponse(MOLT_RATE_LIMITED, rl.error, undefined, null, rl.headers);

  const rawBody = await req.text();

  // Payload size guard — reject before JSON parsing to prevent memory abuse
  if (Buffer.byteLength(rawBody, 'utf-8') > MAX_BODY_BYTES) {
    return moltErrorResponse(MOLT_BAD_REQUEST, `Payload too large (max ${MAX_BODY_BYTES} bytes)`);
  }

  const { moltNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { moltNumber, isActive: true } });
  if (!agent) {
    // ── Cross-carrier routing: check the MoltNumber registry ──
    // If the number isn't local, look it up in the registry. If it belongs
    // to a different carrier, proxy the A2A request there.
    const registryResult = await lookupNumber(moltNumber);
    if (registryResult && registryResult.carrier.domain !== getCarrierDomain()) {
      // Proxy the request to the remote carrier
      const remoteUrl = `${registryResult.carrier.callBaseUrl}/${moltNumber}/tasks/send`;
      try {
        const proxyHeaders: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        // Forward MoltProtocol auth headers if present
        for (const h of ['x-molt-caller', 'x-molt-timestamp', 'x-molt-nonce', 'x-molt-signature']) {
          const v = req.headers.get(h);
          if (v) proxyHeaders[h] = v;
        }
        const proxyResponse = await fetch(remoteUrl, {
          method: 'POST',
          headers: proxyHeaders,
          body: rawBody,
          signal: AbortSignal.timeout(10_000),
        });
        const proxyBody = await proxyResponse.text();
        return new NextResponse(proxyBody, {
          status: proxyResponse.status,
          headers: { 'Content-Type': 'application/json', 'X-Molt-Proxied-Via': getCarrierDomain() },
        });
      } catch {
        return moltErrorResponse(MOLT_NOT_FOUND, 'Remote carrier unreachable', { molt_number: moltNumber });
      }
    }
    return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });
  }
  if (!agent.callEnabled) return moltErrorResponse(MOLT_POLICY_DENIED, 'Agent calling disabled');

  // ── Block inert org-pending agents ──
  // Unclaimed agents on org nations are pending approval — no task delivery.
  if (!agent.ownerId) {
    const agentNation = await prisma.nation.findUnique({ where: { code: agent.nationCode }, select: { type: true } });
    if (agentNation?.type === 'org') {
      return moltErrorResponse(MOLT_POLICY_DENIED, 'Agent is pending org approval and cannot receive tasks');
    }
  }

  const callerNumber = req.headers.get('x-molt-caller');

  // Per-target rate limit — prevent one caller from flooding a single agent
  const targetRl = await rateLimitPerTarget(callerKey, moltNumber);
  if (!targetRl.ok) return moltErrorResponse(MOLT_RATE_LIMITED, targetRl.error, undefined, null, targetRl.headers);

  // ── Resolve caller agent ONCE (used for blocks, policies, and auth) ──
  let callerAgent: { id: string; nationCode: string; publicKey: string | null; moltNumber: string; displayName: string; createdAt: Date } | null = null;
  if (callerNumber) {
    callerAgent = await prisma.agent.findFirst({
      where: { moltNumber: callerNumber, isActive: true },
      select: { id: true, nationCode: true, publicKey: true, moltNumber: true, displayName: true, createdAt: true },
    });
  }
  const requestIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');

  // Carrier-wide block check (before everything else)
  {
    const carrierBlock = await checkCarrierBlock({
      callerAgentId: callerAgent?.id,
      callerMoltNumber: callerNumber,
      callerNation: callerAgent?.nationCode,
      requestIp,
    });
    if (carrierBlock) return moltErrorResponse(MOLT_POLICY_DENIED, carrierBlock);
  }

  // Carrier-wide allow policies (trust requirements)
  {
    const policyCheck = await checkCarrierPolicies(callerAgent?.id ?? null);
    if (!policyCheck.ok) return moltErrorResponse(MOLT_POLICY_DENIED, policyCheck.reason);
  }

  // Per-agent block check
  if (callerAgent && agent.ownerId && await isCallerBlocked(agent.ownerId, callerAgent.id)) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Blocked');
  }

  // Policy + Ed25519 auth
  const policy = await enforcePolicyAndAuth({
    agent,
    callerNumber,
    rawBody,
    method: 'POST',
    path: url.pathname,
    timestamp: req.headers.get('x-molt-timestamp'),
    nonce: req.headers.get('x-molt-nonce'),
    signature: req.headers.get('x-molt-signature'),
  });
  if (!policy.ok) return moltErrorResponse(policy.code!, policy.error);

  // Extended call policy checks (nations, verifications, contacts, age, rate limit)
  const callPolicy = await enforceCallPolicy({
    agent,
    callerMoltNumber: callerNumber,
    callerAgentId: callerAgent?.id ?? null,
    callerNationCode: callerAgent?.nationCode ?? null,
    callerCreatedAt: callerAgent?.createdAt ?? null,
  });
  if (!callPolicy.ok) return moltErrorResponse(callPolicy.code!, callPolicy.error);

  // Track caller verification for carrier identity attestation (STIR/SHAKEN)
  const callerVerified = policy.callerVerified ?? false;
  const callerRegistered = policy.callerRegistered ?? false;

  let parsed: z.infer<typeof bodySchema>;
  try {
    const jsonBody = JSON.parse(rawBody);
    // Support both flat A2A and JSON-RPC 2.0 wrapped payloads:
    //   flat:     { id, message, metadata }
    //   json-rpc: { jsonrpc: "2.0", method: "tasks/send", params: { id, message, metadata } }
    const payload = jsonBody?.jsonrpc === '2.0' && jsonBody?.params ? jsonBody.params : jsonBody;
    parsed = bodySchema.parse(payload);
  } catch {
    return moltErrorResponse(MOLT_BAD_REQUEST, 'Invalid request body');
  }

  const meta = (parsed.metadata || {}) as Record<string, unknown>;
  const rawIntent = meta['molt.intent'];
  if (typeof rawIntent !== 'string' || !rawIntent) {
    return moltErrorResponse(MOLT_BAD_REQUEST, 'Missing molt.intent — must be a non-empty string (e.g. "call", "text")');
  }
  const intent: string = rawIntent;

  // Auto-generate sessionId for call intent so multi-turn conversations always
  // have a session to continue. Without this, the first call response omits
  // sessionId and the caller can't send follow-up messages in the same session.
  if (!parsed.sessionId && intent === 'call') {
    (parsed as { sessionId?: string }).sessionId = cryptoRandomUUID();
  }

  // Use the already-resolved caller agent ID
  const callerAgentId: string | null = callerAgent?.id ?? null;

  // NOTE: Basic messaging is free. Credits are reserved for premium features.
  // carrier_only agents pay for relay traffic (TURN-style persistent allocation).
  // The TARGET's owner is charged — they chose carrier_only for privacy guarantees.
  if (agent.directConnectionPolicy === 'carrier_only') {
    const relayCost = calculateMessageCost(rawBody);
    if (!agent.ownerId) return moltErrorResponse(MOLT_POLICY_DENIED, 'Unclaimed agent cannot use carrier_only relay');
    const chargeResult = await deductRelayCredits(agent.ownerId, relayCost, 'pending', 'inbound');
    if (!chargeResult.ok) {
      return moltErrorResponse(MOLT_POLICY_DENIED, 'Insufficient credits for carrier_only relay', {
        required: relayCost,
        balance: chargeResult.balance,
      });
    }
  }

  // Forwarding chain
  const forwardResult = await resolveForwarding(agent.id, []);
  const targetAgentId = forwardResult.finalAgentId;
  const forwardingHops = forwardResult.hops;
  const loopDetected = forwardResult.hops.length >= parseInt(process.env.MAX_FORWARDING_HOPS || '3', 10);

  const finalAgent = targetAgentId === agent.id
    ? agent
    : (await prisma.agent.findUnique({ where: { id: targetAgentId, isActive: true } }) ?? agent);

  // Helper: create and persist a task record
  const createTask = async (reason: string, status: TaskStatus = TaskStatus.submitted) => {
    const task = await prisma.task.create({
      data: {
        taskId: parsed.id,
        sessionId: parsed.sessionId,
        calleeId: finalAgent.id,
        callerId: callerAgentId,
        intent,
        status,
        forwardingHops,
        messages: { create: { role: 'user', parts: asParts(parsed.message.parts) } },
        events: { create: { type: 'task.created', payload: { reason }, sequenceNumber: 1 } },
      },
    });
    // Prune oldest tasks if the agent exceeds the storage cap (fire-and-forget)
    pruneExcessTasks(finalAgent.id).catch(() => {});
    return task;
  };

  // Helper: publish task event to SSE subscribers (best-effort, non-blocking)
  const publishEvent = (
    task: { id: string; status: string; intent: string },
    eventType: string,
    payload: unknown,
    seq: number,
  ) => {
    const agentIds = [finalAgent.id, callerAgentId].filter(Boolean) as string[];
    publishTaskEvent(agentIds, {
      eventId: `${task.id}-${seq}`,
      taskId: task.id,
      type: eventType,
      payload,
      task: {
        id: task.id,
        status: task.status,
        intent: task.intent,
        callee: { id: finalAgent.id, moltNumber: finalAgent.moltNumber, displayName: finalAgent.displayName },
        caller: callerAgent
          ? { id: callerAgent.id, moltNumber: callerAgent.moltNumber, displayName: callerAgent.displayName }
          : null,
      },
      timestamp: new Date().toISOString(),
      sequenceNumber: seq,
    }).catch(() => {}); // fire-and-forget
  };

  // DND → queue as submitted (pending task / away-message)
  if (finalAgent.dndEnabled) {
    const task = await createTask('dnd');
    publishEvent(task, 'task.created', { reason: 'dnd' }, 1);
    // Best-effort push notification
    if (finalAgent.pushEndpointUrl) {
      sendPushNotification(finalAgent.pushEndpointUrl, {
        taskId: task.id, intent, callerId: callerAgentId, callerNumber, reason: 'dnd',
        awayMessage: finalAgent.awayMessage,
      }).catch(() => {});
    }
    return moltErrorResponse(MOLT_DND, 'Agent on DND (task queued)', {
      task_id: task.id,
      away_message: finalAgent.awayMessage ?? null,
    });
  }

  // Busy → queue as submitted
  // First, expire stale working tasks (>30min without activity)
  const STALE_THRESHOLD_MS = 30 * 60 * 1000;
  await prisma.task.updateMany({
    where: {
      calleeId: finalAgent.id,
      status: TaskStatus.working,
      updatedAt: { lt: new Date(Date.now() - STALE_THRESHOLD_MS) },
    },
    data: { status: TaskStatus.completed },
  });

  const activeTasks = await prisma.task.count({
    where: { calleeId: finalAgent.id, status: TaskStatus.working },
  });
  if (activeTasks >= finalAgent.maxConcurrentCalls) {
    const task = await createTask('busy');
    publishEvent(task, 'task.created', { reason: 'busy' }, 1);
    // Best-effort push notification
    if (finalAgent.pushEndpointUrl) {
      sendPushNotification(finalAgent.pushEndpointUrl, {
        taskId: task.id, intent, callerId: callerAgentId, callerNumber, reason: 'busy',
        awayMessage: finalAgent.awayMessage,
      }).catch(() => {});
    }
    return moltErrorResponse(MOLT_BUSY, 'Agent busy (task queued)', {
      task_id: task.id,
      away_message: finalAgent.awayMessage ?? null,
    });
  }

  const online = isOnline(finalAgent.lastSeenAt);

  // ── Multi-turn: continue an existing session ──────────────────────
  // If sessionId matches a task for this callee, append the new message
  // to that task and forward the full conversation history to the webhook.
  // Include completed tasks so callers can resume finished conversations.
  let existingTask: Awaited<ReturnType<typeof prisma.task.findFirst<{ include: { messages: true } }>>> = null;
  if (parsed.sessionId && intent === 'call') {
    existingTask = await prisma.task.findFirst({
      where: {
        sessionId: parsed.sessionId,
        calleeId: finalAgent.id,
        status: { in: [TaskStatus.working, TaskStatus.input_required, TaskStatus.completed] },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // Online with endpoint → try webhook delivery (respecting circuit breaker)
  const circuitState = getCircuitState(finalAgent);
  if (finalAgent.endpointUrl && online && circuitState !== 'open') {
    const ssrfCheck = await validateWebhookUrl(finalAgent.endpointUrl);
    if (ssrfCheck.ok) {
      // Sign the delivery with carrier identity (STIR/SHAKEN-inspired)
      const attestation = determineAttestation({ callerVerified, callerRegistered });
      const identityHeaders = signDelivery({
        origNumber: callerNumber ?? 'anonymous',
        destNumber: finalAgent.moltNumber,
        body: rawBody,
        attestation,
      });

      // Build the webhook payload. For multi-turn, include the full
      // conversation history so the agent can maintain context.
      let webhookPayload: string;
      if (existingTask) {
        const history = (existingTask.messages as Array<{ role: string; parts: unknown }>).map(m => ({
          role: m.role,
          parts: m.parts,
        }));
        webhookPayload = JSON.stringify({
          id: existingTask.taskId ?? existingTask.id,
          sessionId: parsed.sessionId,
          message: { role: 'user', parts: parsed.message.parts },
          history, // full conversation so far
          metadata: {
            'molt.intent': intent,
            ...(callerNumber ? { 'molt.caller': callerNumber } : {}),
          },
        });
      } else {
        webhookPayload = rawBody;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);
      let webhookErrorType: 'timeout' | 'failed' | null = null;
      try {
        const response = await fetch(finalAgent.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Molt-Target': finalAgent.id,
            'X-Molt-Caller': callerNumber ?? 'anonymous',
            ...identityHeaders,
          },
          body: webhookPayload,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          // Reset circuit breaker on success
          await recordSuccess(finalAgent.id);

          const responseBody = await response.text();
          let responseParts: unknown[];
          let webhookStatus: string | null = null;
          try {
            const parsed2 = JSON.parse(responseBody);
            // Support both flat A2A and JSON-RPC wrapped responses:
            //   flat:     { message: { parts: [...] }, status: { state: '...' } }
            //   json-rpc: { jsonrpc: "2.0", result: { message: { parts: [...] }, status: { state: '...' } } }
            const result = parsed2?.result ?? parsed2;
            const msgParts = result?.message?.parts;
            responseParts = Array.isArray(msgParts)
              ? msgParts
              : [{ type: 'text', text: responseBody }];
            // Respect the webhook's declared status if present
            const rawState = result?.status?.state;
            if (typeof rawState === 'string' && ['completed', 'working', 'input_required', 'failed'].includes(rawState)) {
              webhookStatus = rawState;
            }
          } catch {
            responseParts = [{ type: 'text', text: responseBody }];
          }

          // Multi-turn continuation: append messages to the existing task
          if (existingTask) {
            await prisma.taskMessage.createMany({
              data: [
                { taskId: existingTask.id, role: 'user', parts: asParts(parsed.message.parts), deliveryStatus: 'delivered', deliveredAt: new Date() },
                { taskId: existingTask.id, role: 'agent', parts: asParts(responseParts), deliveryStatus: 'delivered', deliveredAt: new Date() },
              ],
            });
            // Touch updatedAt
            await prisma.task.update({ where: { id: existingTask.id }, data: { status: TaskStatus.working } });
            const seq = (existingTask.messages?.length ?? 0) + 2;
            publishEvent(
              { id: existingTask.id, status: 'working', intent: existingTask.intent },
              'task.message', { role: 'agent', parts: responseParts }, seq,
            );
            return NextResponse.json({
              id: existingTask.id,
              sessionId: parsed.sessionId,
              status: 'working',
              message: { parts: responseParts },
            });
          }

          // Determine status from webhook response or intent default.
          // Respect the webhook's declared status for all intents.
          // Default: call → working (multi-turn), text → completed (fire-and-forget).
          // If the caller wants to continue a completed call session, the
          // multi-turn lookup will find it and reopen it.
          const resolvedStatus: TaskStatus = webhookStatus
            ? (webhookStatus as TaskStatus)
            : (intent === 'call' ? TaskStatus.working : TaskStatus.completed);
          const task = await prisma.task.create({
            data: {
              taskId: parsed.id,
              sessionId: parsed.sessionId,
              calleeId: finalAgent.id,
              callerId: callerAgentId,
              intent,
              status: resolvedStatus,
              forwardingHops,
              messages: {
                create: [
                  { role: 'user', parts: asParts(parsed.message.parts), deliveryStatus: 'delivered', deliveredAt: new Date() },
                  { role: 'agent', parts: asParts(responseParts), deliveryStatus: 'delivered', deliveredAt: new Date() },
                ],
              },
              events: { create: { type: 'task.created', payload: { status: resolvedStatus }, sequenceNumber: 1 } },
            },
          });
          publishEvent(task, 'task.created', { status: resolvedStatus }, 1);
          return NextResponse.json({
            id: task.id,
            sessionId: parsed.sessionId,
            status: resolvedStatus,
            message: { parts: responseParts },
          });
        } else {
          webhookErrorType = 'failed';
        }
      } catch (e) {
        clearTimeout(timeout);
        webhookErrorType = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'failed';
      }

      // Webhook failed or timed out — record failure for circuit breaker + schedule retry
      await recordFailure(finalAgent.id);

      const reason = webhookErrorType === 'timeout' ? 'webhook_timeout' : 'webhook_failed';
      const maxRetries = intent === 'call' ? 3 : 5;
      const task = await prisma.task.create({
        data: {
          taskId: parsed.id,
          sessionId: parsed.sessionId,
          calleeId: finalAgent.id,
          callerId: callerAgentId,
          intent,
          status: TaskStatus.submitted,
          maxRetries,
          forwardingHops,
          lastError: reason,
          messages: { create: { role: 'user', parts: asParts(parsed.message.parts) } },
          events: { create: { type: 'task.created', payload: { reason }, sequenceNumber: 1 } },
        },
      });
      publishEvent(task, 'task.created', { reason }, 1);
      await scheduleRetry(task.id);
      const errorCode = webhookErrorType === 'timeout' ? MOLT_WEBHOOK_TIMEOUT : MOLT_WEBHOOK_FAILED;
      const errorMsg = webhookErrorType === 'timeout' ? 'Webhook timed out (retry scheduled)' : 'Webhook delivery failed (retry scheduled)';
      return moltErrorResponse(errorCode, errorMsg, { task_id: task.id });
    }
  }

  // Forwarding loop → fail
  if (loopDetected) {
    const task = await createTask('forwarding_loop', TaskStatus.failed);
    publishEvent(task, 'task.created', { reason: 'forwarding_loop' }, 1);
    return moltErrorResponse(MOLT_FORWARDING_FAILED, 'Forwarding failed', { task_id: task.id });
  }

  // Offline → queue as submitted
  const task = await createTask('offline');
  publishEvent(task, 'task.created', { reason: 'offline' }, 1);
  // Best-effort push notification
  if (finalAgent.pushEndpointUrl) {
    sendPushNotification(finalAgent.pushEndpointUrl, {
      taskId: task.id, intent, callerId: callerAgentId, callerNumber, reason: 'offline',
      awayMessage: finalAgent.awayMessage,
    }).catch(() => {});
  }
  return moltErrorResponse(MOLT_OFFLINE, 'Agent offline (task queued)', {
    task_id: task.id,
    away_message: finalAgent.awayMessage ?? null,
  });
}
