/**
 * Direct Connection actions — accept, reject, revoke.
 *
 * PATCH /api/agents/:id/direct-connections/:connectionId
 *
 * Body: { "action": "accept" | "reject" | "revoke" }
 *
 * Auth: session-based (owner only). The acting agent must be a participant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  acceptDirectConnection,
  rejectDirectConnection,
  revokeDirectConnection,
} from '@/lib/services/direct-connections';
import { z } from 'zod';

const actionSchema = z.object({
  action: z.enum(['accept', 'reject', 'revoke']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; connectionId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: agentId, connectionId } = await params;
  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const { action } = actionSchema.parse(body);

    let result;

    switch (action) {
      case 'accept': {
        result = await acceptDirectConnection(connectionId, agentId);
        if (result.ok) {
          return NextResponse.json({
            connectionId,
            status: 'accepted',
            // Return the proposer's endpoint + public key to the accepting agent
            peerEndpoint: result.proposerEndpoint,
            peerPublicKey: result.proposerPublicKey,
            upgradeToken: result.upgradeToken,
          });
        }
        break;
      }

      case 'reject': {
        result = await rejectDirectConnection(connectionId, agentId);
        if (result.ok) {
          return NextResponse.json({ connectionId, status: 'rejected' });
        }
        break;
      }

      case 'revoke': {
        result = await revokeDirectConnection(connectionId, agentId);
        if (result.ok) {
          return NextResponse.json({ connectionId, status: 'revoked' });
        }
        break;
      }
    }

    // Error case
    if (result && !result.ok) {
      const statusMap = { not_found: 404, not_authorized: 403, invalid_state: 409, no_endpoint: 400 } as const;
      return NextResponse.json(
        { error: result.reason, code: result.code },
        { status: statusMap[result.code] ?? 400 },
      );
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('Direct connection action error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
