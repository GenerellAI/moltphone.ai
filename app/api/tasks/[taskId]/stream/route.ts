import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/tasks/:taskId/stream — SSE stream for a single task's events.
 *
 * Supports Last-Event-ID for reconnection.
 */

const POLL_INTERVAL_MS = 1500;
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
      callee: { select: { ownerId: true } },
      caller: { select: { ownerId: true } },
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

      const poll = async () => {
        if (closed) return;

        try {
          const events = await prisma.taskEvent.findMany({
            where: { taskId, sequenceNumber: { gt: lastSeq } },
            orderBy: { sequenceNumber: 'asc' },
            take: 50,
          });

          // Also fetch any new messages since last check
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

          // If task reached a terminal state, send a close hint
          const currentTask = await prisma.task.findUnique({
            where: { id: taskId },
            select: { status: true },
          });
          if (currentTask && ['completed', 'canceled', 'failed'].includes(currentTask.status)) {
            enqueue(`event: task.closed\ndata: ${JSON.stringify({ status: currentTask.status })}\n\n`);
            // Keep stream open a bit for client to process, then close
            setTimeout(() => {
              closed = true;
              try { controller.close(); } catch { /* ok */ }
            }, 5000);
          }
        } catch {
          // skip on error
        }
      };

      await poll();

      const pollTimer = setInterval(poll, POLL_INTERVAL_MS);
      const heartbeatTimer = setInterval(() => {
        enqueue(': heartbeat\n\n');
      }, HEARTBEAT_INTERVAL_MS);

      req.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(pollTimer);
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
