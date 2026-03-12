import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';

/**
 * POST /api/tasks/:taskId/cancel — End or cancel an active task from the web UI.
 *
 * Semantics follow telephony conventions:
 * - If the task was **connected** (working/input_required) → `completed` (normal hangup)
 * - If the task was still **ringing** (submitted) → `canceled` (missed call —
 *   the call was never answered. In the future, Phase 6 will add a "decline"
 *   action where the receiver actively rejects an incoming call.)
 *
 * Only the task owner (caller or callee owner) can cancel/end.
 * Already-terminal tasks (completed/canceled/failed) are rejected with 400.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskId } = await params;

  // Look up by primary key first, then fall back to external A2A taskId field
  let task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      callee: { select: { id: true, ownerId: true, moltNumber: true } },
      caller: { select: { id: true, ownerId: true, moltNumber: true } },
    },
  });
  if (!task) {
    task = await prisma.task.findFirst({
      where: { taskId },
      include: {
        callee: { select: { id: true, ownerId: true, moltNumber: true } },
        caller: { select: { id: true, ownerId: true, moltNumber: true } },
      },
    });
  }

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership check: caller or callee owner
  const callerOwnerId = task.caller?.ownerId;
  const calleeOwnerId = task.callee?.ownerId;
  if (calleeOwnerId !== session.user.id && callerOwnerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only active tasks can be canceled
  const terminalStatuses: TaskStatus[] = [TaskStatus.completed, TaskStatus.canceled, TaskStatus.failed];
  if (terminalStatuses.includes(task.status)) {
    return NextResponse.json(
      { error: `Task already in terminal state: ${task.status}` },
      { status: 400 }
    );
  }

  const dbId = task.id;
  const seqNum = await prisma.taskEvent.count({ where: { taskId: dbId } }) + 1;

  // Determine the correct terminal status based on telephony semantics:
  // - submitted (still ringing, never connected) → canceled (missed call)
  // - working / input_required (was connected) → completed (normal hangup)
  const newStatus = task.status === TaskStatus.submitted
    ? TaskStatus.canceled
    : TaskStatus.completed;
  const eventType = newStatus === TaskStatus.canceled ? 'task.canceled' : 'task.status';

  await prisma.$transaction([
    prisma.task.update({
      where: { id: dbId },
      data: { status: newStatus },
    }),
    prisma.taskEvent.create({
      data: {
        taskId: dbId,
        type: eventType,
        payload: { by: 'ui', userId: session.user.id, status: newStatus },
        sequenceNumber: seqNum,
      },
    }),
  ]);

  // Publish to SSE subscribers (best-effort)
  const agentIds = [task.calleeId, task.callerId].filter(Boolean) as string[];
  publishTaskEvent(agentIds, {
    eventId: `${dbId}-${seqNum}`,
    taskId: dbId,
    type: eventType,
    payload: { by: 'ui', userId: session.user.id, status: newStatus },
    task: {
      id: dbId,
      status: newStatus,
      intent: task.intent,
      ...(task.callee ? { callee: { id: task.callee.id, moltNumber: task.callee.moltNumber, displayName: '' } } : {}),
      ...(task.caller ? { caller: { id: task.caller.id, moltNumber: task.caller.moltNumber, displayName: '' } } : {}),
    },
    timestamp: new Date().toISOString(),
    sequenceNumber: seqNum,
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: dbId, status: newStatus });
}
