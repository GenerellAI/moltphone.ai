import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/nations/mine — returns nations the user owns, admins, or has agents in.
 * Each nation is annotated with a `role` field: 'owner' | 'admin' | 'member'.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  // Find nation codes where the user has agents
  const agentNations = await prisma.agent.findMany({
    where: { ownerId: userId, isActive: true },
    select: { nationCode: true },
    distinct: ['nationCode'],
  });
  const agentNationCodes = agentNations.map(a => a.nationCode);

  const nations = await prisma.nation.findMany({
    where: {
      isActive: true,
      OR: [
        { ownerId: userId },
        { adminUserIds: { has: userId } },
        ...(agentNationCodes.length > 0 ? [{ code: { in: agentNationCodes } }] : []),
      ],
    },
    include: {
      _count: { select: { agents: true } },
    },
    orderBy: { code: 'asc' },
  });

  // Annotate with role
  const annotated = nations.map(nation => ({
    ...nation,
    role: nation.ownerId === userId
      ? 'owner'
      : (nation.adminUserIds as string[]).includes(userId)
        ? 'admin'
        : 'member',
  }));

  return NextResponse.json(annotated);
}
