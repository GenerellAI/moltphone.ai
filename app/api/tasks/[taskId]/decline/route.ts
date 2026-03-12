import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';

/**
 * POST /api/tasks/:taskId/decline — Decline an inbound ringing call.
 *
 * Transitions a task from `submitted` (ringing) to `canceled`.
 * Unlike a timeout-based missed call, this records that the callee actively
 * declined. The event payload includes `action: 'declined'` for audit purposes.
 *
 * Only the callee owner can decline.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      callee: { select: { id: true, ownerId: true, moltNumber: true, displayName: true } },
      caller: { select: { id: true, ownerId: true, moltNumber: true, displayName: true } },
    },
  });

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Only the callee owner can decline
  if (task.callee?.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Only the callee can decline a call' }, { status: 403 });
  }

  // Must be ringing (submitted)
  if (task.status !== TaskStatus.submitted) {
    return NextResponse.json(
      { error: `Cannot decline task in ${task.status} state — must be submitted (ringing)` },
      { status: 400 }
    );
  }

  const seqNum = await prisma.taskEvent.count({ where: { taskId: task.id } }) + 1;

  await prisma.$transaction([
    prisma.task.update({
      where: { id: task.id },
      data: { status: TaskStatus.canceled },
    }),
    prisma.taskEvent.create({
      data: {
        taskId: task.id,
        type: 'task.canceled',
        payload: { by: 'ui', userId: session.user.id, status: 'canceled', action: 'declined' },
        sequenceNumber: seqNum,
      },
    }),
  ]);

  // Publish to SSE subscribers
  const agentIds = [task.calleeId, task.callerId].filter(Boolean) as string[];
  publishTaskEvent(agentIds, {
    eventId: `${task.id}-${seqNum}`,
    taskId: task.id,
    type: 'task.canceled',
    payload: { by: 'ui', userId: session.user.id, status: 'canceled', action: 'declined' },
    task: {
      id: task.id,
      status: 'canceled',
      intent: task.intent,
      callee: task.callee ? { id: task.callee.id, moltNumber: task.callee.moltNumber, displayName: task.callee.displayName } : undefined,
      caller: task.caller ? { id: task.caller.id, moltNumber: task.caller.moltNumber, displayName: task.caller.displayName } : undefined,
    },
    timestamp: new Date().toISOString(),
    sequenceNumber: seqNum,
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: task.id, status: 'canceled' });
}
