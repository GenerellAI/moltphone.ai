/**
 * POST /dial/:phoneNumber/tasks/:taskId/reply
 *
 * Reply to a queued task.  The callee (inbox owner) sends this.
 * Auth: Ed25519 (agent signs with own private key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { moltErrorResponse } from '@/lib/errors';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_BAD_REQUEST,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
  MOLT_CONFLICT,
} from '@/core/moltprotocol/src/errors';
import { Prisma, TaskStatus } from '@prisma/client';
import { z } from 'zod';
import { deductMessageCredits } from '@/lib/services/credits';

function asParts(parts: unknown): Prisma.InputJsonValue { return parts as Prisma.InputJsonValue; }

const textPartSchema = z.object({ type: z.literal('text'), text: z.string().min(1) });
const dataPartSchema = z.object({ type: z.literal('data'), data: z.record(z.string(), z.unknown()) });
const filePartSchema = z.object({ type: z.literal('file'), mimeType: z.string(), uri: z.string() });
const partSchema = z.discriminatedUnion('type', [textPartSchema, dataPartSchema, filePartSchema]);

const bodySchema = z.object({
  message: z.object({ parts: z.array(partSchema).min(1) }),
  final: z.boolean().default(false),
});

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

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }
  if (callerHeader !== phoneNumber) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Only the callee may reply to their own tasks');
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (nonceUsed) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

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
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  await prisma.nonceUsed.create({ data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) } });

  const task = await prisma.task.findUnique({ where: { id: taskId, calleeId: agent.id } });
  if (!task) return moltErrorResponse(MOLT_NOT_FOUND, 'Task not found', { task_id: taskId });
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return moltErrorResponse(MOLT_CONFLICT, 'Task already closed', { task_id: taskId, status: task.status });
  }

  // Deduct credits from the replying agent's owner for this message
  const creditResult = await deductMessageCredits(agent.ownerId, taskId, 'Reply message');
  if (!creditResult.ok) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Insufficient credits', {
      balance: creditResult.balance,
    });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return moltErrorResponse(MOLT_BAD_REQUEST, 'Invalid request body');
  }

  const newStatus = parsed.final ? TaskStatus.completed : TaskStatus.input_required;
  const seqNum = await prisma.taskEvent.count({ where: { taskId } }) + 1;

  await prisma.$transaction([
    prisma.taskMessage.create({ data: { taskId, role: 'agent', parts: asParts(parsed.message.parts) } }),
    prisma.task.update({ where: { id: taskId }, data: { status: newStatus } }),
    prisma.taskEvent.create({
      data: { taskId, type: 'task.message', payload: { role: 'agent' }, sequenceNumber: seqNum },
    }),
  ]);

  return NextResponse.json({ id: taskId, status: newStatus });
}
