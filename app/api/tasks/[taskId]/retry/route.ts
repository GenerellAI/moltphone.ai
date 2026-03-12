import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { scheduleRetry } from '@/lib/services/webhook-reliability';

/**
 * POST /api/tasks/:taskId/retry — Retry a failed task.
 *
 * Resets the task to submitted status and schedules an immediate retry.
 * Only the task owner (caller or callee owner) can retry.
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
      callee: { select: { id: true, ownerId: true } },
      caller: { select: { id: true, ownerId: true } },
    },
  });

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership check
  const callerOwnerId = task.caller?.ownerId;
  const calleeOwnerId = task.callee?.ownerId;
  if (calleeOwnerId !== session.user.id && callerOwnerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Only failed tasks can be retried
  if (task.status !== 'failed') {
    return NextResponse.json({ error: 'Only failed tasks can be retried' }, { status: 400 });
  }

  // Reset task for retry: set back to submitted, clear error, reset retry count
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: 'submitted',
      lastError: null,
      retryCount: 0,
      nextRetryAt: new Date(), // Immediate retry
    },
  });

  // Schedule via the retry worker
  await scheduleRetry(taskId);

  return NextResponse.json({ ok: true, message: 'Task queued for retry' });
}
