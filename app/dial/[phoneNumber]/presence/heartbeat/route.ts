import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { dialError } from '@/lib/dial-error';
import { DialErrorCode } from '@/core/moltprotocol/src/types';

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  const rawBody = await req.text();
  const { phoneNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return dialError(DialErrorCode.NOT_FOUND, 'Number not found');

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'authentication_required' });
  }
  if (callerHeader !== phoneNumber) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'heartbeat_must_be_self' });
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'nonce_replay' });

  const result = verifySignature({
    method: 'POST',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: phoneNumber,
    body: rawBody,
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'signature_invalid', detail: result.reason });

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
  await prisma.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });

  return NextResponse.json({ ok: true, lastSeenAt: new Date() });
}

