/**
 * Direct Connection management for an agent.
 *
 * POST /api/agents/:id/direct-connections         — Propose upgrade
 * GET  /api/agents/:id/direct-connections         — List connections
 *
 * Auth: session-based (owner only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  proposeDirectConnection,
  maybeAutoAccept,
  listDirectConnections,
} from '@/lib/services/direct-connections';
import { z } from 'zod';

const proposeSchema = z.object({
  targetAgentId: z.string().min(1),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: agentId } = await params;
  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const data = proposeSchema.parse(body);

    const result = await proposeDirectConnection(agentId, data.targetAgentId);

    if (!result.ok) {
      const statusMap = { policy_denied: 403, already_exists: 409, no_endpoint: 400, self_connection: 400, not_found: 404 } as const;
      return NextResponse.json(
        { error: result.reason, code: result.code },
        { status: statusMap[result.code] ?? 400 },
      );
    }

    // Check for auto-accept (direct_on_accept policy)
    const autoAccepted = await maybeAutoAccept(result.connectionId, data.targetAgentId);

    if (autoAccepted) {
      return NextResponse.json({
        connectionId: autoAccepted.connectionId,
        status: 'accepted',
        autoAccepted: true,
        proposerEndpoint: autoAccepted.proposerEndpoint,
        targetEndpoint: autoAccepted.targetEndpoint,
        upgradeToken: autoAccepted.upgradeToken,
        targetPublicKey: autoAccepted.targetPublicKey,
      }, { status: 201 });
    }

    return NextResponse.json({
      connectionId: result.connectionId,
      status: 'proposed',
      expiresAt: result.expiresAt.toISOString(),
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('Direct connection propose error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: agentId } = await params;
  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status') as import('@prisma/client').DirectConnectionStatus | null;

  const connections = await listDirectConnections(agentId, {
    status: statusFilter ?? undefined,
    limit: 50,
  });

  // Strip endpoint URLs from response — only show them to the relevant party
  const mapped = connections.map((c) => ({
    id: c.id,
    proposer: c.proposerAgent,
    target: c.targetAgent,
    status: c.status,
    proposedAt: c.proposedAt,
    acceptedAt: c.acceptedAt,
    activatedAt: c.activatedAt,
    revokedAt: c.revokedAt,
    revokedBy: c.revokedBy,
    expiresAt: c.expiresAt,
    // Only show your own endpoint back to you, never the other party's
    ...(c.proposerAgentId === agentId
      ? { myEndpoint: c.proposerEndpoint, peerEndpoint: c.targetEndpoint }
      : { myEndpoint: c.targetEndpoint, peerEndpoint: c.proposerEndpoint }),
    upgradeToken: c.status === 'accepted' && c.proposerAgentId === agentId ? c.upgradeToken : undefined,
  }));

  return NextResponse.json(mapped);
}
