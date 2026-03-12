import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { personalAgentId: true },
  });
  const personalAgentId = user?.personalAgentId ?? null;

  const agents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      _count: { select: { socialVerifications: { where: { status: 'verified' } }, tasksAsCallee: true, tasksAsCaller: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Strip sensitive fields and annotate personal agent
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const mapped = agents.map(({ endpointUrl: _eu, publicKey: _pk, _count, ...rest }) => ({
    ...rest,
    verifiedCount: _count?.socialVerifications ?? 0,
    conversationCount: (_count?.tasksAsCallee ?? 0) + (_count?.tasksAsCaller ?? 0),
    isPersonalAgent: rest.id === personalAgentId,
  }));

  // Pin personal agent to front of list
  mapped.sort((a, b) => {
    if (a.isPersonalAgent && !b.isPersonalAgent) return -1;
    if (!a.isPersonalAgent && b.isPersonalAgent) return 1;
    return 0;
  });

  return NextResponse.json(mapped);
}
