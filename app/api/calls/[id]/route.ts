import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** GET /api/calls/:id — get a single task with its messages. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const task = await prisma.task.findUnique({
    where: { id },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true, ownerId: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      events: { orderBy: { sequenceNumber: 'asc' } },
    },
  });
  
  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  
  if (task.callee?.ownerId !== session.user.id && task.caller?.id) {
    const callerAgent = await prisma.agent.findUnique({ where: { id: task.caller.id } });
    if (callerAgent?.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  
  return NextResponse.json(task);
}
