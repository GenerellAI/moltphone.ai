/**
 * POST /call/:moltNumber/tasks/:taskId/reply
 *
 * Reply to a queued task.  The callee (inbox owner) sends this.
 * Auth: Ed25519 (agent signs with own private key).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { calculateMessageCost, deductRelayCredits } from '@/lib/services/credits';
import { moltErrorResponse } from '@/lib/errors';
import { isNonceReplay } from '@/lib/nonce';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_BAD_REQUEST,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
  MOLT_CONFLICT,
} from '@moltprotocol/core';
import { Prisma, TaskStatus } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ moltNumber: string; taskId: string }> }) {
  const rawBody = await req.text();
  const { moltNumber, taskId } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { moltNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  // Org agents with callEnabled=false are blocked by the agent's own
  // Ed25519 auth check below (they have no MoltSIM until approved).

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required');
  }
  if (callerHeader !== moltNumber) {
    return moltErrorResponse(MOLT_POLICY_DENIED, 'Only the callee may reply to their own tasks');
  }

  const nonceKey = `${callerHeader}:${nonce}`;
  if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

  const result = verifySignature({
    method: 'POST',
    path: url.pathname,
    callerAgentId: callerHeader,
    targetAgentId: moltNumber,
    body: rawBody,
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

  const task = await prisma.task.findUnique({
    where: { id: taskId, calleeId: agent.id },
    include: {
      caller: { select: { id: true, moltNumber: true, displayName: true } },
    },
  });
  if (!task) return moltErrorResponse(MOLT_NOT_FOUND, 'Task not found', { task_id: taskId });
  if (task.status === TaskStatus.completed || task.status === TaskStatus.canceled) {
    return moltErrorResponse(MOLT_CONFLICT, 'Task already closed', { task_id: taskId, status: task.status });
  }

  // NOTE: Basic messaging is free. Credits are reserved for premium features.
  // carrier_only agents pay for outbound relay traffic (TURN-style).
  if (agent.directConnectionPolicy === 'carrier_only') {
    const relayCost = calculateMessageCost(rawBody);
    if (!agent.ownerId) return moltErrorResponse(MOLT_POLICY_DENIED, 'Unclaimed agent cannot use carrier_only relay');
    const chargeResult = await deductRelayCredits(agent.ownerId, relayCost, taskId, 'outbound');
    if (!chargeResult.ok) {
      return moltErrorResponse(MOLT_POLICY_DENIED, 'Insufficient credits for carrier_only relay', {
        required: relayCost,
        balance: chargeResult.balance,
      });
    }
  }

  let parsed: z.infer<typeof bodySchema>;
  try {
    const jsonBody = JSON.parse(rawBody);
    // Support both flat A2A and JSON-RPC 2.0 wrapped payloads
    const payload = jsonBody?.jsonrpc === '2.0' && jsonBody?.params ? jsonBody.params : jsonBody;
    parsed = bodySchema.parse(payload);
  } catch {
    return moltErrorResponse(MOLT_BAD_REQUEST, 'Invalid request body');
  }

  const newStatus = parsed.final ? TaskStatus.completed : TaskStatus.input_required;
  const seqNum = await prisma.taskEvent.count({ where: { taskId } }) + 1;

  await prisma.$transaction([
    prisma.taskMessage.create({ data: { taskId, role: 'agent', parts: asParts(parsed.message.parts) } }),
    prisma.task.update({ where: { id: taskId }, data: { status: newStatus } }),
    prisma.taskEvent.create({
      data: { taskId, type: 'task.message', payload: { role: 'agent', parts: parsed.message.parts } as Prisma.InputJsonValue, sequenceNumber: seqNum },
    }),
  ]);

  // Publish to SSE subscribers (best-effort)
  const agentIds = [agent.id, task.callerId].filter(Boolean) as string[];
  publishTaskEvent(agentIds, {
    eventId: `${taskId}-${seqNum}`,
    taskId,
    type: 'task.message',
    payload: { role: 'agent', parts: parsed.message.parts },
    task: {
      id: taskId,
      status: newStatus,
      intent: task.intent,
      callee: { id: agent.id, moltNumber: agent.moltNumber, displayName: agent.displayName },
      caller: task.caller ?? null,
    },
    timestamp: new Date().toISOString(),
    sequenceNumber: seqNum,
  }).catch(() => {});

  return NextResponse.json({ id: taskId, status: newStatus });
}
