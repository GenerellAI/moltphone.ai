import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const userAgents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true },
  });
  const agentIds = userAgents.map(a => a.id);
  
  const calls = await prisma.call.findMany({
    where: {
      OR: [
        { calleeId: { in: agentIds } },
        { callerId: { in: agentIds } },
      ],
    },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true } },
      voicemails: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  
  return NextResponse.json(calls);
}
