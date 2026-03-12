import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/notifications/unread — Count unseen calls and messages.
 *
 * Returns { calls: number, messages: number } where each count represents
 * tasks created after the user's lastSeenCallAt / lastSeenMessageAt.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { lastSeenCallAt: true, lastSeenMessageAt: true },
  });

  const agentIds = (
    await prisma.agent.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true },
    })
  ).map(a => a.id);

  if (agentIds.length === 0) {
    return NextResponse.json({ calls: 0, messages: 0 });
  }

  const agentFilter = {
    OR: [{ calleeId: { in: agentIds } }, { callerId: { in: agentIds } }],
  };

  const [calls, messages] = await Promise.all([
    prisma.task.count({
      where: {
        ...agentFilter,
        intent: 'call',
        ...(user?.lastSeenCallAt ? { createdAt: { gt: user.lastSeenCallAt } } : {}),
      },
    }),
    prisma.task.count({
      where: {
        ...agentFilter,
        intent: 'text',
        ...(user?.lastSeenMessageAt ? { createdAt: { gt: user.lastSeenMessageAt } } : {}),
      },
    }),
  ]);

  return NextResponse.json({ calls, messages });
}
