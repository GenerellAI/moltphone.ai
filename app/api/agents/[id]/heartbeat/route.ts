/**
 * POST /api/agents/:id/heartbeat
 *
 * Session-authenticated presence heartbeat for browser clients.
 * Updates the agent's `lastSeenAt` to keep it "online".
 * Only the agent's owner can send heartbeats.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    select: { id: true, ownerId: true },
  });

  if (!agent || agent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  await prisma.agent.update({
    where: { id },
    data: { lastSeenAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
