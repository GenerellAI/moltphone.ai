/**
 * POST /dial/:phoneNumber/tasks/:taskId/cancel
 *
 * Cancel a task.  Either the caller or callee may cancel.
 * Auth: Ed25519.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { moltErrorResponse } from '@/lib/errors';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
  MOLT_CONFLICT,
} from '@/core/moltprotocol/src/errors';
import { TaskStatus } from '@prisma/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string; taskId: string }> }) {
  const rawBody = await req.text();
  const { phoneNumber, taskId } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { phone_number: phoneNumber });

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }

  // Caller may be the callee (cancelling their own task) or the original caller.
  // Resolve the authenticating agent's public key.
  const authAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerHeader, isActive: true } });
  if (!authAgent?.publicKey) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller has no public key');

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

  const result = verifySignature({
    method: 'POST',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: phoneNumber,
    body: rawBody,
    publicKey: authAgent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { caller: true },
  });
  if (!task) return moltErrorResponse(MOLT_NOT_FOUND, 'Task not found', { task_id: taskId });
  if (task.calleeId !== agent.id && task.caller?.phoneNumber !== callerHeader) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Not authorized to cancel this task');
  }
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return moltErrorResponse(MOLT_CONFLICT, 'Task already closed', { task_id: taskId, status: task.status });
  }

  const seqNum = await prisma.taskEvent.count({ where: { taskId } }) + 1;
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: TaskStatus.canceled } }),
    prisma.taskEvent.create({
      data: { taskId, type: 'task.canceled', payload: { by: callerHeader }, sequenceNumber: seqNum },
    }),
  ]);

  return NextResponse.json({ id: taskId, status: 'canceled' });
}
