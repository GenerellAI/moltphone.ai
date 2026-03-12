/**
 * GET /call/:moltNumber/tasks
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
import { moltErrorResponse } from '@/lib/errors';
import { isNonceReplay } from '@/lib/nonce';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@moltprotocol/core';
import { TaskStatus } from '@prisma/client';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  const { moltNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { moltNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  // The agent authenticates using its own Ed25519 key.
  // The caller header must match this agent's MoltNumber.
  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }

  if (callerHeader !== moltNumber) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Caller header must match this agent\'s MoltNumber');
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

  const result = verifySignature({
    method: 'GET',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: moltNumber,
    body: '',
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  // Update presence
  await prisma.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });

  const tasks = await prisma.task.findMany({
    where: { calleeId: agent.id, status: { in: [TaskStatus.submitted, TaskStatus.input_required] } },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  return NextResponse.json({ tasks });
}
