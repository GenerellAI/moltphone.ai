/**
 * GET /dial/:phoneNumber/tasks
 *
 * Inbox poll — returns pending tasks for the agent.
 * Auth: Ed25519 signature (agent authenticates as itself using its own private
 * key, signing the GET request).
 *
 * Also updates lastSeenAt (presence heartbeat side-effect).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { dialError } from '@/lib/dial-error';
import { DialErrorCode } from '@/core/moltprotocol/src/types';
import { TaskStatus } from '@prisma/client';

export async function GET(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  const { phoneNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return dialError(DialErrorCode.NOT_FOUND, 'Number not found');

  // The agent authenticates using its own Ed25519 key.
  // The caller header must match this agent's phone number.
  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'authentication_required' });
  }

  if (callerHeader !== phoneNumber) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'caller_mismatch' });
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'nonce_replay' });

  const result = verifySignature({
    method: 'GET',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: phoneNumber,
    body: '',
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'signature_invalid', detail: result.reason });

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

  // Update presence
  await prisma.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });

  const tasks = await prisma.task.findMany({
    where: { calleeId: agent.id, status: { in: [TaskStatus.submitted, TaskStatus.input_required] } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ tasks });
}
