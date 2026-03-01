import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id },
    include: {
      agent: {
        include: { nation: { select: { code: true, displayName: true, badge: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(favorites);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { agentId } = z.object({ agentId: z.string() }).parse(await req.json());
  
  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  const fav = await prisma.favorite.upsert({
    where: { userId_agentId: { userId: session.user.id, agentId } },
    create: { userId: session.user.id, agentId },
    update: {},
    include: { agent: true },
  });
  return NextResponse.json(fav, { status: 201 });
}
