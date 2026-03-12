import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { moltErrorResponse } from '@/lib/errors';
import { isNonceReplay } from '@/lib/nonce';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@moltprotocol/core';

export async function POST(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  const rawBody = await req.text();
  const { moltNumber } = await params;
  const url = new URL(req.url);
  const canonicalPath = url.pathname;

  const agent = await prisma.agent.findUnique({ where: { moltNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }
  if (callerHeader !== moltNumber) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Heartbeat must be sent by the agent itself');
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

  const result = verifySignature({
    method: 'POST',
    path: canonicalPath,
    callerAgentId: callerHeader,
    targetAgentId: moltNumber,
    body: rawBody,
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  await prisma.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });

  return NextResponse.json({ ok: true, lastSeenAt: new Date() });
}

