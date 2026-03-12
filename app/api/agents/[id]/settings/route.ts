import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';

/**
 * GET /api/agents/:id/settings
 *
 * Agent Settings view — owner-only.  Returns the full agent configuration
 * including endpointUrl, allowlistAgentIds, awayMessage, forwarding, DND.
 * The publicKey is included so owners can reference it; privateKey is never
 * stored and cannot be retrieved here.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true, personalAgentId: true } },
    },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const isPersonalAgent = agent.owner?.personalAgentId === agent.id;
  return NextResponse.json({ ...agent, online: isOnline(agent.lastSeenAt), isPersonalAgent });
}
