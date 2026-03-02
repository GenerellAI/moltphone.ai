/**
 * POST /api/direct-connections/verify-token
 *
 * Verify and consume a direct connection upgrade token.
 *
 * When an agent receives the first direct A2A request from a peer, the request
 * should include `molt.upgrade_token` in metadata. The receiving agent calls
 * this endpoint to verify the token is legitimate and consume it.
 *
 * This is the ICE connectivity check equivalent — confirming that the
 * direct connection was authorized by the carrier.
 *
 * Auth: Ed25519 signature or session-based.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyAndConsumeUpgradeToken } from '@/lib/services/direct-connections';
import { z } from 'zod';

const bodySchema = z.object({
  upgradeToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { upgradeToken } = bodySchema.parse(body);

    const result = await verifyAndConsumeUpgradeToken(upgradeToken);

    if (!result.ok) {
      return NextResponse.json({ error: result.reason, valid: false }, { status: 400 });
    }

    return NextResponse.json({
      valid: true,
      connectionId: result.connectionId,
      proposerAgentId: result.proposerAgentId,
      targetAgentId: result.targetAgentId,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
