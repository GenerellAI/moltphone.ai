import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/tasks/:taskId — Full task detail with messages and events.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskId } = await params;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true, ownerId: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true, ownerId: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { sequenceNumber: 'asc' } },
    },
  });

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership check: user must own the callee or caller agent
  const callerOwnerId = task.caller?.ownerId;
  const calleeOwnerId = task.callee?.ownerId;
  if (calleeOwnerId !== session.user.id && callerOwnerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(task);
}
