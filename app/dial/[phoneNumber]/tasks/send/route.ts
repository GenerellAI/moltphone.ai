/**
 * POST /dial/:phoneNumber/tasks/send
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
 *     "molt.caller": "SOLR-AAAA-BBBB-CCCC-D"
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
import { resolveForwarding, enforcePolicyAndAuth, isCallerBlocked, checkCarrierBlock } from '@/lib/services/task-routing';
import { checkCarrierPolicies } from '@/lib/services/carrier-policies';
import { getCircuitState, recordSuccess, recordFailure, scheduleRetry } from '@/lib/services/webhook-reliability';
import { sendPushNotification } from '@/lib/services/push-notifications';
import { rateLimit, rateLimitKey } from '@/lib/rate-limit';
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
} from '@/core/moltprotocol/src/errors';
import { Prisma, TaskIntent, TaskStatus } from '@prisma/client';
import { z } from 'zod';

// Helper: cast typed parts to Prisma JSON
function asParts(parts: unknown): Prisma.InputJsonValue { return parts as Prisma.InputJsonValue; }

const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS || '5000', 10);

const textPartSchema = z.object({ type: z.literal('text'), text: z.string().min(1) });
const dataPartSchema = z.object({ type: z.literal('data'), data: z.record(z.string(), z.unknown()) });
const filePartSchema = z.object({ type: z.literal('file'), mimeType: z.string(), uri: z.string() });
const partSchema = z.discriminatedUnion('type', [textPartSchema, dataPartSchema, filePartSchema]);

const bodySchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  message: z.object({
    parts: z.array(partSchema).min(1),
  }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  // Rate limit (before any DB queries)
  const rl = rateLimit(rateLimitKey(req));
  if (!rl.ok) return moltErrorResponse(MOLT_RATE_LIMITED, rl.error);

  const rawBody = await req.text();
  const { phoneNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { phone_number: phoneNumber });
  if (!agent.dialEnabled) return moltErrorResponse(MOLT_POLICY_DENIED, 'Agent dialling disabled');

  const callerNumber = req.headers.get('x-molt-caller');

  // Carrier-wide block check (before everything else)
  {
    let callerAgentForBlock: { id: string; nationCode: string } | null = null;
    if (callerNumber) {
      callerAgentForBlock = await prisma.agent.findFirst({
        where: { phoneNumber: callerNumber, isActive: true },
        select: { id: true, nationCode: true },
      });
    }
    const requestIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
    const carrierBlock = await checkCarrierBlock({
      callerAgentId: callerAgentForBlock?.id,
      callerPhone: callerNumber,
      callerNation: callerAgentForBlock?.nationCode,
      requestIp,
    });
    if (carrierBlock) return moltErrorResponse(MOLT_POLICY_DENIED, carrierBlock);
  }

  // Carrier-wide allow policies (trust requirements)
  {
    let callerAgentIdForPolicy: string | null = null;
    if (callerNumber) {
      const ca = await prisma.agent.findFirst({
        where: { phoneNumber: callerNumber, isActive: true },
        select: { id: true },
      });
      callerAgentIdForPolicy = ca?.id ?? null;
    }
    const policyCheck = await checkCarrierPolicies(callerAgentIdForPolicy);
    if (!policyCheck.ok) return moltErrorResponse(MOLT_POLICY_DENIED, policyCheck.reason);
  }

  // Per-agent block check
  if (callerNumber) {
    const callerAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerNumber, isActive: true } });
    if (callerAgent && await isCallerBlocked(agent.ownerId, callerAgent.id)) {
      return moltErrorResponse(MOLT_POLICY_DENIED, 'Blocked');
    }
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

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return moltErrorResponse(MOLT_BAD_REQUEST, 'Invalid request body');
  }

  const meta = (parsed.metadata || {}) as Record<string, unknown>;
  const rawIntent = meta['molt.intent'];
  const intent: TaskIntent = rawIntent === 'text' ? 'text' : 'call';

  // Resolve caller agent id
  let callerAgentId: string | null = null;
  if (callerNumber) {
    const ca = await prisma.agent.findFirst({ where: { phoneNumber: callerNumber, isActive: true } });
    callerAgentId = ca?.id ?? null;
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
  const createTask = (reason: string, status: TaskStatus = TaskStatus.submitted) =>
    prisma.task.create({
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

  // DND → queue as submitted (pending task / away-message)
  if (finalAgent.dndEnabled) {
    const task = await createTask('dnd');
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
  const activeTasks = await prisma.task.count({
    where: { calleeId: finalAgent.id, status: TaskStatus.working },
  });
  if (activeTasks >= finalAgent.maxConcurrentCalls) {
    const task = await createTask('busy');
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

  // Online with endpoint → try webhook delivery (respecting circuit breaker)
  const circuitState = getCircuitState(finalAgent);
  if (finalAgent.endpointUrl && online && circuitState !== 'open') {
    const ssrfCheck = await validateWebhookUrl(finalAgent.endpointUrl);
    if (ssrfCheck.ok) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);
      let webhookErrorType: 'timeout' | 'failed' | null = null;
      try {
        const response = await fetch(finalAgent.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-MoltPhone-Target': finalAgent.id },
          body: rawBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          // Reset circuit breaker on success
          await recordSuccess(finalAgent.id);

          const responseBody = await response.text();
          let responseParts: unknown[];
          try {
            const parsed2 = JSON.parse(responseBody);
            responseParts = Array.isArray(parsed2?.message?.parts)
              ? parsed2.message.parts
              : [{ type: 'text', text: responseBody }];
          } catch {
            responseParts = [{ type: 'text', text: responseBody }];
          }
          const task = await prisma.task.create({
            data: {
              taskId: parsed.id,
              sessionId: parsed.sessionId,
              calleeId: finalAgent.id,
              callerId: callerAgentId,
              intent,
              status: intent === 'text' ? TaskStatus.completed : TaskStatus.working,
              forwardingHops,
              messages: {
                create: [
                  { role: 'user', parts: asParts(parsed.message.parts) },
                  { role: 'agent', parts: asParts(responseParts) },
                ],
              },
              events: { create: { type: 'task.created', payload: { status: 'working' }, sequenceNumber: 1 } },
            },
          });
          return NextResponse.json({
            id: task.id,
            status: intent === 'text' ? 'completed' : 'working',
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
      await scheduleRetry(task.id);
      const errorCode = webhookErrorType === 'timeout' ? MOLT_WEBHOOK_TIMEOUT : MOLT_WEBHOOK_FAILED;
      const errorMsg = webhookErrorType === 'timeout' ? 'Webhook timed out (retry scheduled)' : 'Webhook delivery failed (retry scheduled)';
      return moltErrorResponse(errorCode, errorMsg, { task_id: task.id });
    }
  }

  // Forwarding loop → fail
  if (loopDetected) {
    const task = await createTask('forwarding_loop', TaskStatus.failed);
    return moltErrorResponse(MOLT_FORWARDING_FAILED, 'Forwarding failed', { task_id: task.id });
  }

  // Offline → queue as submitted
  const task = await createTask('offline');
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
