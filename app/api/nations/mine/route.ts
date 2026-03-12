import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/nations/mine — returns nations the user owns or admins.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userId = session.user.id;

  const nations = await prisma.nation.findMany({
    where: {
      isActive: true,
      OR: [
        { ownerId: userId },
        { adminUserIds: { has: userId } },
      ],
    },
    include: {
      _count: { select: { agents: true } },
    },
    orderBy: { code: 'asc' },
  });

  return NextResponse.json(nations);
}
