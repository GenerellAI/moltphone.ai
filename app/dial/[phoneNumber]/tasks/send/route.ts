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
import { resolveForwarding, enforcePolicyAndAuth, isCallerBlocked } from '@/lib/services/task-routing';
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
  const rawBody = await req.text();
  const { phoneNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.dialEnabled) return NextResponse.json({ error: 'Agent dialling disabled' }, { status: 403 });

  const callerNumber = req.headers.get('x-molt-caller');

  // Block check (before policy, for efficiency)
  if (callerNumber) {
    const callerAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerNumber, isActive: true } });
    if (callerAgent && await isCallerBlocked(agent.ownerId, callerAgent.id)) {
      return NextResponse.json({ error: 'Blocked' }, { status: 403 });
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
  if (!policy.ok) return NextResponse.json({ error: policy.error }, { status: policy.status });

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
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

  // DND → queue as submitted (pending task / away-message)
  if (finalAgent.dndEnabled) {
    const task = await prisma.task.create({
      data: {
        taskId: parsed.id,
        sessionId: parsed.sessionId,
        calleeId: finalAgent.id,
        callerId: callerAgentId,
        intent,
        status: TaskStatus.submitted,
        forwardingHops,
        messages: { create: { role: 'user', parts: asParts(parsed.message.parts) } },
        events: { create: { type: 'task.created', payload: { reason: 'dnd' }, sequenceNumber: 1 } },
      },
    });
    return NextResponse.json({
      id: task.id,
      status: 'submitted',
      reason: 'dnd',
      away_message: finalAgent.awayMessage ?? null,
    });
  }

  // Busy → queue as submitted
  const activeTasks = await prisma.task.count({
    where: { calleeId: finalAgent.id, status: TaskStatus.working },
  });
  if (activeTasks >= finalAgent.maxConcurrentCalls) {
    const task = await prisma.task.create({
      data: {
        taskId: parsed.id,
        sessionId: parsed.sessionId,
        calleeId: finalAgent.id,
        callerId: callerAgentId,
        intent,
        status: TaskStatus.submitted,
        forwardingHops,
        messages: { create: { role: 'user', parts: asParts(parsed.message.parts) } },
        events: { create: { type: 'task.created', payload: { reason: 'busy' }, sequenceNumber: 1 } },
      },
    });
    return NextResponse.json({
      id: task.id,
      status: 'submitted',
      reason: 'busy',
      away_message: finalAgent.awayMessage ?? null,
    });
  }

  const online = isOnline(finalAgent.lastSeenAt);

  // Online with endpoint → try webhook delivery
  if (finalAgent.endpointUrl && online) {
    const ssrfCheck = await validateWebhookUrl(finalAgent.endpointUrl);
    if (ssrfCheck.ok) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);
      try {
        const response = await fetch(finalAgent.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-MoltPhone-Target': finalAgent.id },
          body: rawBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
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
        }
      } catch {
        clearTimeout(timeout);
      }
    }
  }

  // Offline or webhook failed → queue
  const queueStatus: TaskStatus = loopDetected ? TaskStatus.failed : TaskStatus.submitted;
  const task = await prisma.task.create({
    data: {
      taskId: parsed.id,
      sessionId: parsed.sessionId,
      calleeId: finalAgent.id,
      callerId: callerAgentId,
      intent,
      status: queueStatus,
      forwardingHops,
      messages: { create: { role: 'user', parts: asParts(parsed.message.parts) } },
      events: {
        create: {
          type: 'task.created',
          payload: { reason: loopDetected ? 'forwarding_loop' : (online ? 'webhook_failed' : 'offline') },
          sequenceNumber: 1,
        },
      },
    },
  });

  // For text intent always treat as submitted (async delivery)
  return NextResponse.json({
    id: task.id,
    status: queueStatus,
    away_message: queueStatus === TaskStatus.submitted ? (finalAgent.awayMessage ?? null) : null,
  });
}
