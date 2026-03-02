import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/tasks/stream — SSE stream of task events across all of a user's agents.
 *
 * Query params:
 *   agentId       — optional filter to one agent
 *   Last-Event-ID — resume from a specific event (sequence-based)
 *
 * Events:
 *   task.created   — new inbound/outbound task
 *   task.status    — status change
 *   task.message   — new message in a conversation
 *   task.canceled  — task canceled
 */

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 15000;

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL(req.url);
  const agentIdFilter = url.searchParams.get('agentId');
  const lastEventId = req.headers.get('last-event-id');

  // Resolve agent IDs
  let agentIds: string[];
  if (agentIdFilter) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentIdFilter, ownerId: session.user.id, isActive: true },
      select: { id: true },
    });
    if (!agent) return new Response('Agent not found', { status: 404 });
    agentIds = [agent.id];
  } else {
    const agents = await prisma.agent.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true },
    });
    agentIds = agents.map(a => a.id);
  }

  if (agentIds.length === 0) {
    return new Response('No agents', { status: 404 });
  }

  // Parse the last-event-id to get the cursor timestamp
  let cursorTimestamp: Date | null = null;
  if (lastEventId) {
    const ts = new Date(lastEventId);
    if (!isNaN(ts.getTime())) cursorTimestamp = ts;
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(data)); } catch { closed = true; }
        }
      };

      // Send initial retry interval
      enqueue('retry: 3000\n\n');

      let lastTimestamp = cursorTimestamp || new Date(Date.now() - 60000);

      const poll = async () => {
        if (closed) return;

        try {
          // Get task IDs for user's agents
          const taskFilter = {
            OR: [
              { calleeId: { in: agentIds } },
              { callerId: { in: agentIds } },
            ],
          };

          const events = await prisma.taskEvent.findMany({
            where: {
              task: taskFilter,
              timestamp: { gt: lastTimestamp },
            },
            include: {
              task: {
                include: {
                  callee: { select: { id: true, phoneNumber: true, displayName: true } },
                  caller: { select: { id: true, phoneNumber: true, displayName: true } },
                },
              },
            },
            orderBy: { timestamp: 'asc' },
            take: 50,
          });

          for (const event of events) {
            const eventData = {
              eventId: event.id,
              taskId: event.taskId,
              type: event.type,
              payload: event.payload,
              task: {
                id: event.task.id,
                status: event.task.status,
                intent: event.task.intent,
                callee: event.task.callee,
                caller: event.task.caller,
              },
              timestamp: event.timestamp.toISOString(),
              sequenceNumber: event.sequenceNumber,
            };

            enqueue(`id: ${event.timestamp.toISOString()}\nevent: ${event.type}\ndata: ${JSON.stringify(eventData)}\n\n`);
            lastTimestamp = event.timestamp;
          }
        } catch {
          // DB error — skip this cycle
        }
      };

      // Initial poll for catch-up
      await poll();

      // Periodic polling
      const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

      // Heartbeat to keep connection alive
      const heartbeatTimer = setInterval(() => {
        enqueue(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      // Cleanup on abort
      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
        try { controller.close(); } catch { /* already closed */ }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
