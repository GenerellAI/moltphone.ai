import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const blocks = await prisma.block.findMany({
    where: { userId: session.user.id },
    include: { blockedAgent: { include: { nation: { select: { code: true, displayName: true, badge: true } } } } },
  });
  return NextResponse.json(blocks);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { agentId, reason } = z.object({ agentId: z.string(), reason: z.string().optional() }).parse(await req.json());
  
  const block = await prisma.block.upsert({
    where: { userId_blockedAgentId: { userId: session.user.id, blockedAgentId: agentId } },
    create: { userId: session.user.id, blockedAgentId: agentId, reason },
    update: { reason },
  });
  return NextResponse.json(block, { status: 201 });
}
