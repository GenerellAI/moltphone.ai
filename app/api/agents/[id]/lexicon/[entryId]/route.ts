/**
 * DELETE /api/agents/:id/lexicon/:entryId — Remove a single lexicon entry (owner-only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, entryId } = await params;

  const agent = await prisma.agent.findUnique({ where: { id, isActive: true }, select: { ownerId: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const entry = await prisma.lexiconEntry.findUnique({ where: { id: entryId } });
  if (!entry || entry.agentId !== id) return NextResponse.json({ error: 'Entry not found' }, { status: 404 });

  await prisma.lexiconEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ deleted: true });
}
