import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { subscribeToAgents, SSETaskEvent } from '@/lib/sse-events';

/**
 * GET /api/tasks/:taskId/stream — SSE stream for a single task's events.
 *
 * Supports Last-Event-ID for reconnection.
 *
 * Delivery:
 *   Primary: In-memory EventEmitter (instant, same-instance)
 *   Cross-instance: DB polling every 5s (Upstash HTTP does not support SUBSCRIBE)
 */

const FALLBACK_POLL_INTERVAL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 15000;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 });

  const { taskId } = await params;

  // Verify task exists and user owns one of the agents
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      callee: { select: { id: true, ownerId: true } },
      caller: { select: { id: true, ownerId: true } },
    },
  });
  if (!task) return new Response('Not found', { status: 404 });
  if (task.callee.ownerId !== session.user.id && task.caller?.ownerId !== session.user.id) {
    return new Response('Forbidden', { status: 403 });
  }

  const lastEventId = req.headers.get('last-event-id');
  let lastSeq = 0;
  if (lastEventId) {
    const n = parseInt(lastEventId, 10);
    if (!isNaN(n)) lastSeq = n;
  }

  // Subscribe to both callee and caller agent channels
  const agentIds = [task.callee.id, task.caller?.id].filter(Boolean) as string[];

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const enqueue = (data: string) => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(data)); } catch { closed = true; }
        }
      };

      enqueue('retry: 2000\n\n');

      // ── Initial catch-up poll ──
      try {
        const events = await prisma.taskEvent.findMany({
          where: { taskId, sequenceNumber: { gt: lastSeq } },
          orderBy: { sequenceNumber: 'asc' },
          take: 50,
        });

        for (const event of events) {
          const data = {
            eventId: event.id,
            taskId: event.taskId,
            type: event.type,
            payload: event.payload,
            sequenceNumber: event.sequenceNumber,
            timestamp: event.timestamp.toISOString(),
          };
          enqueue(`id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
          lastSeq = event.sequenceNumber;
        }
      } catch {
        // catch-up failed — continue with Pub/Sub
      }

      // Check if task is already in terminal state
      const checkTerminal = async () => {
        try {
          const currentTask = await prisma.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (currentTask && ['completed', 'canceled', 'failed'].includes(currentTask.status)) {
            enqueue(`event: task.closed\ndata: ${JSON.stringify({ status: currentTask.status })}\n\n`);
            setTimeout(() => {
              closed = true;
              unsubscribe();
              clearInterval(fallbackTimer);
              clearInterval(heartbeatTimer);
              try { controller.close(); } catch { /* ok */ }
            }, 5000);
          }
        } catch { /* skip */ }
      };

      await checkTerminal();

      // ── Subscribe to Pub/Sub for real-time events ──
      const unsubscribe = subscribeToAgents(agentIds, (event: SSETaskEvent) => {
        if (closed) return;
        // Filter to only events for THIS task
        if (event.taskId !== taskId) return;

        const data = {
          eventId: event.eventId,
          taskId: event.taskId,
          type: event.type,
          payload: event.payload,
          sequenceNumber: event.sequenceNumber,
          timestamp: event.timestamp,
        };
        enqueue(`id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
        lastSeq = event.sequenceNumber;

        // Check for terminal state
        if (event.task?.status && ['completed', 'canceled', 'failed'].includes(event.task.status)) {
          enqueue(`event: task.closed\ndata: ${JSON.stringify({ status: event.task.status })}\n\n`);
          setTimeout(() => {
            closed = true;
            unsubscribe();
            clearInterval(fallbackTimer);
            clearInterval(heartbeatTimer);
            try { controller.close(); } catch { /* ok */ }
          }, 5000);
        }
      });

      // ── Fallback poll ──
      const fallbackPoll = async () => {
        if (closed) return;
        try {
          const events = await prisma.taskEvent.findMany({
            where: { taskId, sequenceNumber: { gt: lastSeq } },
            orderBy: { sequenceNumber: 'asc' },
            take: 50,
          });

          for (const event of events) {
            const data = {
              eventId: event.id,
              taskId: event.taskId,
              type: event.type,
              payload: event.payload,
              sequenceNumber: event.sequenceNumber,
              timestamp: event.timestamp.toISOString(),
            };
            enqueue(`id: ${event.sequenceNumber}\nevent: ${event.type}\ndata: ${JSON.stringify(data)}\n\n`);
            lastSeq = event.sequenceNumber;
          }

          await checkTerminal();
        } catch {
          // skip
        }
      };

      const fallbackTimer = setInterval(fallbackPoll, FALLBACK_POLL_INTERVAL_MS);

      const heartbeatTimer = setInterval(() => {
        enqueue(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      req.signal.addEventListener('abort', () => {
        closed = true;
        unsubscribe();
        clearInterval(fallbackTimer);
        clearInterval(heartbeatTimer);
        try { controller.close(); } catch { /* ok */ }
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
