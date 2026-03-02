/**
 * POST /dial/:phoneNumber/tasks/:taskId/cancel
 *
 * Cancel a task.  Either the caller or callee may cancel.
 * Auth: Ed25519.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { TaskStatus } from '@prisma/client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string; taskId: string }> }) {
  const rawBody = await req.text();
  const { phoneNumber, taskId } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!callerHeader || !timestamp || !nonce || !signature) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  // Caller may be the callee (cancelling their own task) or the original caller.
  // Resolve the authenticating agent's public key.
  const authAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerHeader, isActive: true } });
  if (!authAgent?.publicKey) return NextResponse.json({ error: 'Caller has no public key' }, { status: 403 });

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return NextResponse.json({ error: 'Nonce replay detected' }, { status: 403 });

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
  if (!result.valid) return NextResponse.json({ error: `Signature invalid: ${result.reason}` }, { status: 403 });

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { caller: true },
  });
  if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 });
  if (task.calleeId !== agent.id && task.caller?.phoneNumber !== callerHeader) {
    return NextResponse.json({ error: 'Not authorized to cancel this task' }, { status: 403 });
  }
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return NextResponse.json({ error: 'Task already closed' }, { status: 409 });
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
