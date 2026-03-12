import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/tasks/:taskId — Full task detail with messages and events.
 *
 * Side effects:
 * - Marks opposite party's messages as "seen" (delivery receipt)
 * - Promotes "sent" messages to "delivered" if the task has progressed
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
      callee: { select: { id: true, moltNumber: true, displayName: true, ownerId: true } },
      caller: { select: { id: true, moltNumber: true, displayName: true, ownerId: true } },
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

  // Determine the viewer's role: if user owns the callee agent, they're the "agent" side
  const isCallee = calleeOwnerId === session.user.id;
  const oppositeRole = isCallee ? 'user' : 'agent';

  // Mark opposite party's messages as "seen" (best-effort, non-blocking)
  const now = new Date();
  const unseenMessageIds = task.messages
    .filter(m => m.role === oppositeRole && m.deliveryStatus !== 'seen')
    .map(m => m.id);

  if (unseenMessageIds.length > 0) {
    prisma.taskMessage.updateMany({
      where: { id: { in: unseenMessageIds } },
      data: { deliveryStatus: 'seen', seenAt: now },
    }).catch(() => {}); // fire-and-forget
  }

  // Promote "sent" → "delivered" if the task has progressed past submitted
  const deliveredStatuses = ['working', 'input_required', 'completed'];
  if (deliveredStatuses.includes(task.status)) {
    const sentMessageIds = task.messages
      .filter(m => m.deliveryStatus === 'sent')
      .map(m => m.id);

    if (sentMessageIds.length > 0) {
      prisma.taskMessage.updateMany({
        where: { id: { in: sentMessageIds } },
        data: { deliveryStatus: 'delivered', deliveredAt: now },
      }).catch(() => {}); // fire-and-forget
    }
  }

  // Return with updated delivery status applied locally (avoid re-fetch)
  const updatedMessages = task.messages.map(m => {
    if (unseenMessageIds.includes(m.id)) {
      return { ...m, deliveryStatus: 'seen', seenAt: now };
    }
    if (deliveredStatuses.includes(task.status) && m.deliveryStatus === 'sent') {
      return { ...m, deliveryStatus: 'delivered', deliveredAt: now };
    }
    return m;
  });

  return NextResponse.json({ ...task, messages: updatedMessages });
}
