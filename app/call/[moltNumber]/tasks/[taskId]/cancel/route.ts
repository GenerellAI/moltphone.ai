/**
 * POST /call/:moltNumber/tasks/:taskId/cancel
 *
 * Cancel a task.  Either the caller or callee may cancel.
 * Auth: Ed25519.
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
  MOLT_CONFLICT,
} from '@moltprotocol/core';
import { TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';

export async function POST(req: NextRequest, { params }: { params: Promise<{ moltNumber: string; taskId: string }> }) {
  const rawBody = await req.text();
  const { moltNumber, taskId } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { moltNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }

  // Caller may be the callee (cancelling their own task) or the original caller.
  // Resolve the authenticating agent's public key.
  const authAgent = await prisma.agent.findFirst({ where: { moltNumber: callerHeader, isActive: true } });
  if (!authAgent?.publicKey) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller has no public key');

  const nonceKey = `${callerHeader}:${nonce}`;
  if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

  const result = verifySignature({
    method: 'POST',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: moltNumber,
    body: rawBody,
    publicKey: authAgent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { caller: true },
  });
  if (!task) return moltErrorResponse(MOLT_NOT_FOUND, 'Task not found', { task_id: taskId });

  // Only the callee (owner of this endpoint) or the original caller may cancel
  const isCallee = callerHeader === agent.moltNumber;
  const isOriginalCaller = task.caller?.moltNumber === callerHeader;
  if (!isCallee && !isOriginalCaller) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Not authorized to cancel this task');
  }
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return moltErrorResponse(MOLT_CONFLICT, 'Task already closed', { task_id: taskId, status: task.status });
  }

  // Determine terminal status using telephony semantics:
  // - submitted (still ringing, never connected) → canceled (missed call)
  // - working / input_required (was connected) → completed (normal hangup)
  const newStatus = task.status === TaskStatus.submitted
    ? TaskStatus.canceled
    : TaskStatus.completed;
  const eventType = newStatus === TaskStatus.canceled ? 'task.canceled' : 'task.status';

  const seqNum = await prisma.taskEvent.count({ where: { taskId } }) + 1;
  await prisma.$transaction([
    prisma.task.update({ where: { id: taskId }, data: { status: newStatus } }),
    prisma.taskEvent.create({
      data: { taskId, type: eventType, payload: { by: callerHeader, status: newStatus }, sequenceNumber: seqNum },
    }),
  ]);

  // Publish to SSE subscribers (best-effort)
  const agentIds = [agent.id, task.callerId].filter(Boolean) as string[];
  publishTaskEvent(agentIds, {
    eventId: `${taskId}-${seqNum}`,
    taskId,
    type: eventType,
    payload: { by: callerHeader, status: newStatus },
    task: { id: taskId, status: newStatus, intent: task.intent },
    timestamp: new Date().toISOString(),
    sequenceNumber: seqNum,
  }).catch(() => {});

  return NextResponse.json({ id: taskId, status: newStatus });
}
