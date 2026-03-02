/**
 * POST /dial/:phoneNumber/tasks/:taskId/cancel
 *
 * Cancel a task.  Either the caller or callee may cancel.
 * Auth: Ed25519.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { dialError } from '@/lib/dial-error';
import { DialErrorCode } from '@/core/moltprotocol/src/types';
import { TaskStatus } from '@prisma/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string; taskId: string }> }) {
  const rawBody = await req.text();
  const { phoneNumber, taskId } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return dialError(DialErrorCode.NOT_FOUND, 'Number not found');

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!callerHeader || !timestamp || !nonce || !signature) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'authentication_required' });
  }

  // Caller may be the callee (cancelling their own task) or the original caller.
  // Resolve the authenticating agent's public key.
  const authAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerHeader, isActive: true } });
  if (!authAgent?.publicKey) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'caller_not_found' });

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'nonce_replay' });

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
  if (!result.valid) return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'signature_invalid', detail: result.reason });

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { caller: true },
  });
  if (!task) return dialError(DialErrorCode.NOT_FOUND, 'Task not found');
  if (task.calleeId !== agent.id && task.caller?.phoneNumber !== callerHeader) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'not_authorized_to_cancel' });
  }
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return dialError(DialErrorCode.BAD_REQUEST, 'Bad request', { reason: 'task_already_closed' });
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
