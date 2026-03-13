/**
 * POST /api/agents/:id/chat/stream
 *
 * Streaming chat endpoint. Returns SSE (text/event-stream) so the UI can
 * display tokens as they arrive from the agent's webhook.
 *
 * Body: { message: string, intent: "call" | "text", sessionId?: string }
 *
 * SSE events emitted:
 *   event: token   — { text: "..." }   partial text chunk
 *   event: done    — { taskId, sessionId, status }   final metadata
 *   event: error   — { message: "..." }
 *
 * If the agent webhook returns `text/event-stream`, chunks are relayed in
 * real-time. If it returns JSON, the full response is sent as a single
 * token event followed by done.
 */

import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { validateWebhookUrl } from '@/lib/ssrf';
import { resolveForwarding } from '@/lib/services/task-routing';
import { getCircuitState, recordSuccess, recordFailure } from '@/lib/services/webhook-reliability';
import { signDelivery, determineAttestation } from '@/lib/carrier-identity';
import { randomUUID } from 'crypto';
import { Prisma, TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';

const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS || '30000', 10);

function asParts(parts: unknown): Prisma.InputJsonValue { return parts as Prisma.InputJsonValue; }

function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response(sseMessage('error', { message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    select: {
      id: true, moltNumber: true, displayName: true, endpointUrl: true,
      callEnabled: true, inboundPolicy: true, allowlistAgentIds: true,
      dndEnabled: true, maxConcurrentCalls: true, lastSeenAt: true,
      ownerId: true, callForwardingEnabled: true, forwardToAgentId: true,
      forwardCondition: true, awayMessage: true, directConnectionPolicy: true,
      webhookFailures: true, isDegraded: true, circuitOpenUntil: true,
      pushEndpointUrl: true, publicKey: true, nationCode: true,
      callPolicyIn: true, isActive: true, skills: true,
      previousNumbers: true, createdAt: true, updatedAt: true,
      avatarUrl: true, description: true, badge: true, tagline: true,
      specializations: true, languages: true, responseTimeSla: true,
      callPolicyOut: true,
    },
  });
  if (!agent) {
    return new Response(sseMessage('error', { message: 'Agent not found' }), {
      status: 404,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const body = await req.json();
  const message = body.message?.trim();
  if (!message) {
    return new Response(sseMessage('error', { message: 'Message is required' }), {
      status: 400,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const intent = body.intent || 'call';
  const sessionId = body.sessionId || randomUUID();

  // Resolve caller identity
  const user = session.user as { id: string; personalAgentId?: string | null; personalMoltNumber?: string | null };
  let callerNumber = user.personalMoltNumber ?? null;
  let callerAgentId: string | null = null;

  if (!callerNumber && user.personalAgentId) {
    const pa = await prisma.agent.findUnique({
      where: { id: user.personalAgentId, isActive: true },
      select: { moltNumber: true, id: true },
    });
    callerNumber = pa?.moltNumber ?? null;
    callerAgentId = pa?.id ?? null;
  }

  if (callerNumber && !callerAgentId) {
    const ca = await prisma.agent.findFirst({
      where: { moltNumber: callerNumber, isActive: true },
      select: { id: true, nationCode: true, publicKey: true, displayName: true, createdAt: true },
    });
    callerAgentId = ca?.id ?? null;
  }

  // ── Forwarding chain ──────────────────────────────────
  const forwardResult = await resolveForwarding(agent.id, []);
  const targetAgentId = forwardResult.finalAgentId;
  const forwardingHops = forwardResult.hops;

  // Resolve final agent (full record needed for all the checks below)
  const finalAgent = targetAgentId === agent.id
    ? agent as typeof agent & Record<string, unknown>
    : (await prisma.agent.findUnique({ where: { id: targetAgentId, isActive: true } }) ?? agent) as typeof agent & Record<string, unknown>;

  // DND check
  if (finalAgent.dndEnabled) {
    return new Response(sseMessage('error', { message: 'Agent is on DND', away_message: finalAgent.awayMessage }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // Busy check
  const activeTasks = await prisma.task.count({
    where: { calleeId: finalAgent.id, status: TaskStatus.working },
  });
  if (activeTasks >= finalAgent.maxConcurrentCalls) {
    return new Response(sseMessage('error', { message: 'Agent busy', away_message: finalAgent.awayMessage }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  const online = isOnline(finalAgent.lastSeenAt);

  if (!finalAgent.endpointUrl || !online) {
    return new Response(
      sseMessage('error', { message: 'Agent offline' }) +
      sseMessage('done', { status: 'offline' }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  const circuitState = getCircuitState(finalAgent as Parameters<typeof getCircuitState>[0]);
  if (circuitState === 'open') {
    return new Response(sseMessage('error', { message: 'Agent temporarily unavailable' }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // SSRF check
  const ssrfCheck = await validateWebhookUrl(finalAgent.endpointUrl);
  if (!ssrfCheck.ok) {
    return new Response(sseMessage('error', { message: 'Webhook validation failed' }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }

  // ── Multi-turn: find existing session ─────────────────
  let existingTask: Awaited<ReturnType<typeof prisma.task.findFirst<{ include: { messages: true } }>>> = null;
  if (sessionId && intent === 'call') {
    existingTask = await prisma.task.findFirst({
      where: {
        sessionId,
        calleeId: finalAgent.id,
        status: { in: [TaskStatus.working, TaskStatus.input_required, TaskStatus.completed] },
      },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // Build webhook payload (same logic as tasks/send)
  const taskPayload = {
    id: randomUUID(),
    sessionId,
    message: { role: 'user', parts: [{ type: 'text', text: message }] },
    metadata: {
      'molt.intent': intent,
      ...(callerNumber ? { 'molt.caller': callerNumber } : {}),
    },
  };

  let webhookPayload: string;
  if (existingTask) {
    const history = (existingTask.messages as Array<{ role: string; parts: unknown }>).map(m => ({
      role: m.role,
      parts: m.parts,
    }));
    webhookPayload = JSON.stringify({
      id: existingTask.taskId ?? existingTask.id,
      sessionId,
      message: { role: 'user', parts: [{ type: 'text', text: message }] },
      history,
      metadata: {
        'molt.intent': intent,
        ...(callerNumber ? { 'molt.caller': callerNumber } : {}),
      },
    });
  } else {
    webhookPayload = JSON.stringify(taskPayload);
  }

  // Sign carrier identity
  const attestation = determineAttestation({ callerVerified: false, callerRegistered: !!callerNumber });
  const identityHeaders = signDelivery({
    origNumber: callerNumber ?? 'anonymous',
    destNumber: finalAgent.moltNumber,
    body: webhookPayload,
    attestation,
  });

  // ── Fetch webhook with streaming preference ───────────
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);

  let webhookResponse: Response;
  try {
    webhookResponse = await fetch(finalAgent.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream, application/json',
        'X-Molt-Target': finalAgent.id,
        'X-Molt-Caller': callerNumber ?? 'anonymous',
        ...identityHeaders,
      },
      body: webhookPayload,
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch (e) {
    clearTimeout(timeout);
    await recordFailure(finalAgent.id);
    const isTimeout = e instanceof Error && e.name === 'AbortError';
    return new Response(
      sseMessage('error', { message: isTimeout ? 'Webhook timed out' : 'Webhook failed' }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  if (!webhookResponse.ok) {
    await recordFailure(finalAgent.id);
    return new Response(
      sseMessage('error', { message: `Webhook returned ${webhookResponse.status}` }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  await recordSuccess(finalAgent.id);

  const contentType = webhookResponse.headers.get('content-type') ?? '';
  const isStreaming = contentType.includes('text/event-stream');

  // ── Create the SSE response stream ────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(streamController) {
      let fullText = '';

      const enqueue = (data: string) => {
        streamController.enqueue(encoder.encode(data));
      };

      try {
        if (isStreaming && webhookResponse.body) {
          // ── Relay streaming response ──────────────────
          const reader = webhookResponse.body.getReader();
          const decoder = new TextDecoder();
          let sseBuffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });

            // Parse SSE lines
            const lines = sseBuffer.split('\n');
            // Keep the last potentially incomplete line in the buffer
            sseBuffer = lines.pop() ?? '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  // Support multiple SSE formats from the agent:
                  // 1. OpenAI-style: { choices: [{ delta: { content: "..." } }] }
                  // 2. A2A-style: { message: { parts: [{ type: "text", text: "..." }] } }
                  // 3. Simple: { text: "..." }
                  // 4. Anthropic-style: { type: "content_block_delta", delta: { text: "..." } }
                  let chunk = '';
                  if (parsed?.choices?.[0]?.delta?.content) {
                    chunk = parsed.choices[0].delta.content;
                  } else if (parsed?.message?.parts) {
                    chunk = parsed.message.parts
                      .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
                      .map((p: { text: string }) => p.text)
                      .join('');
                  } else if (typeof parsed?.text === 'string') {
                    chunk = parsed.text;
                  } else if (parsed?.delta?.text) {
                    chunk = parsed.delta.text;
                  } else if (parsed?.type === 'content_block_delta' && parsed?.delta?.text) {
                    chunk = parsed.delta.text;
                  }

                  if (chunk) {
                    fullText += chunk;
                    enqueue(sseMessage('token', { text: chunk }));
                  }
                } catch {
                  // Non-JSON data line — skip
                }
              }
            }
          }
        } else {
          // ── Non-streaming JSON response ───────────────
          const responseBody = await webhookResponse.text();
          try {
            const parsed = JSON.parse(responseBody);
            const result = parsed?.result ?? parsed;
            const msgParts = result?.message?.parts;
            if (Array.isArray(msgParts)) {
              fullText = msgParts
                .filter((p: { type: string; text?: string }) => p.type === 'text' && p.text)
                .map((p: { text: string }) => p.text)
                .join('\n');
            } else {
              fullText = responseBody;
            }
          } catch {
            fullText = responseBody;
          }
          enqueue(sseMessage('token', { text: fullText }));
        }

        // ── Persist to database ─────────────────────────
        const responseParts = [{ type: 'text', text: fullText }];

        if (existingTask) {
          await prisma.taskMessage.createMany({
            data: [
              { taskId: existingTask.id, role: 'user', parts: asParts([{ type: 'text', text: message }]), deliveryStatus: 'delivered', deliveredAt: new Date() },
              { taskId: existingTask.id, role: 'agent', parts: asParts(responseParts), deliveryStatus: 'delivered', deliveredAt: new Date() },
            ],
          });
          await prisma.task.update({ where: { id: existingTask.id }, data: { status: TaskStatus.working } });

          const seq = (existingTask.messages?.length ?? 0) + 2;
          const agentIds = [finalAgent.id, callerAgentId].filter(Boolean) as string[];
          publishTaskEvent(agentIds, {
            eventId: `${existingTask.id}-${seq}`,
            taskId: existingTask.id,
            type: 'task.message',
            payload: { role: 'agent', parts: responseParts },
            timestamp: new Date().toISOString(),
            sequenceNumber: seq,
          }).catch(() => {});

          enqueue(sseMessage('done', {
            taskId: existingTask.id,
            sessionId,
            status: 'working',
          }));
        } else {
          const task = await prisma.task.create({
            data: {
              taskId: taskPayload.id,
              sessionId,
              calleeId: finalAgent.id,
              callerId: callerAgentId,
              intent,
              status: intent === 'call' ? TaskStatus.working : TaskStatus.completed,
              forwardingHops,
              messages: {
                create: [
                  { role: 'user', parts: asParts([{ type: 'text', text: message }]), deliveryStatus: 'delivered', deliveredAt: new Date() },
                  { role: 'agent', parts: asParts(responseParts), deliveryStatus: 'delivered', deliveredAt: new Date() },
                ],
              },
              events: { create: { type: 'task.created', payload: { status: 'working' }, sequenceNumber: 1 } },
            },
          });

          const agentIds = [finalAgent.id, callerAgentId].filter(Boolean) as string[];
          publishTaskEvent(agentIds, {
            eventId: `${task.id}-1`,
            taskId: task.id,
            type: 'task.created',
            payload: { status: task.status },
            timestamp: new Date().toISOString(),
            sequenceNumber: 1,
          }).catch(() => {});

          enqueue(sseMessage('done', {
            taskId: task.id,
            sessionId,
            status: task.status,
          }));
        }

        streamController.close();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        enqueue(sseMessage('error', { message: detail }));
        streamController.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
