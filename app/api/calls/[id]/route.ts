import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const call = await prisma.call.findUnique({
    where: { id: params.id },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true, ownerId: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      voicemails: true,
    },
  });
  
  if (!call) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  if (call.callee?.ownerId !== session.user.id && call.caller?.id) {
    const callerAgent = await prisma.agent.findUnique({ where: { id: call.caller.id } });
    if (callerAgent?.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  
  return NextResponse.json(call);
}
