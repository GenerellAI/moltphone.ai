/**
 * POST /dial/:phoneNumber/tasks/:taskId/reply
 *
 * Reply to a queued task.  The callee (inbox owner) sends this.
 * Auth: Ed25519 (agent signs with own private key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { dialError } from '@/lib/dial-error';
import { DialErrorCode } from '@/core/moltprotocol/src/types';
import { Prisma, TaskStatus } from '@prisma/client';
import { z } from 'zod';

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
  if (!agent) return dialError(DialErrorCode.NOT_FOUND, 'Number not found');

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'authentication_required' });
  }
  if (callerHeader !== phoneNumber) {
    return dialError(DialErrorCode.POLICY_DENIED, 'Policy denied', { reason: 'only_callee_may_reply' });
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

  const task = await prisma.task.findUnique({ where: { id: taskId, calleeId: agent.id } });
  if (!task) return dialError(DialErrorCode.NOT_FOUND, 'Task not found');
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return dialError(DialErrorCode.BAD_REQUEST, 'Bad request', { reason: 'task_already_closed' });
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    parsed = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return dialError(DialErrorCode.BAD_REQUEST, 'Bad request', { reason: 'invalid_body' });
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
