/**
 * GET /call/:moltNumber/lexicon
 *
 * Public lexicon endpoint — returns the agent's Lexicon Pack as JSON.
 * Access-controlled by inbound policy (same as Agent Card).
 *
 * Response:
 * {
 *   "agent": "SOLR-12AB-C3D4-EF56",
 *   "vocabulary": ["MoltNumber", "MoltSIM", ...],
 *   "corrections": [{ "from": "moltnumber", "to": "MoltNumber" }, ...]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toLexiconJson } from '@/lib/lexicon-csv';
import { moltErrorResponse } from '@/lib/errors';
import { verifySignature } from '@/lib/ed25519';
import { isNonceReplay } from '@/lib/nonce';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@moltprotocol/core';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  const { moltNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({
    where: { moltNumber, isActive: true },
    select: { id: true, moltNumber: true, inboundPolicy: true, allowlistAgentIds: true },
  });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  // Access control — mirrors agent.json logic
  if (agent.inboundPolicy !== 'public') {
    const callerHeader = req.headers.get('x-molt-caller');
    const timestamp = req.headers.get('x-molt-timestamp');
    const nonce = req.headers.get('x-molt-nonce');
    const signature = req.headers.get('x-molt-signature');

    if (!callerHeader || !timestamp || !nonce || !signature) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller authentication required');
    }

    const callerAgent = await prisma.agent.findFirst({ where: { moltNumber: callerHeader, isActive: true } });
    if (!callerAgent?.publicKey) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller not found or has no public key');
    }

    // Nonce replay check
    const nonceKey = `${callerHeader}:${nonce}`;
    if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

    const result = verifySignature({
      method: 'GET',
      path: url.pathname,
      callerAgentId: callerHeader,
      targetAgentId: moltNumber,
      body: '',
      publicKey: callerAgent.publicKey,
      timestamp,
      nonce,
      signature,
    });
    if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

    // Enforce policy
    if (agent.inboundPolicy === 'allowlist' && !agent.allowlistAgentIds.includes(callerAgent.id)) {
      return moltErrorResponse(MOLT_POLICY_DENIED, 'Caller not in allowlist');
    }
  }

  const entries = await prisma.lexiconEntry.findMany({
    where: { agentId: agent.id },
    orderBy: [{ type: 'asc' }, { term: 'asc' }],
  });

  const data = toLexiconJson(entries);

  return NextResponse.json({
    agent: agent.moltNumber,
    ...data,
  });
}
