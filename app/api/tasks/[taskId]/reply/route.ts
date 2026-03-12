import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { TaskStatus, Prisma } from '@prisma/client';
import { publishTaskEvent } from '@/lib/sse-events';
import { z } from 'zod';

function asParts(parts: unknown): Prisma.InputJsonValue { return parts as Prisma.InputJsonValue; }

const bodySchema = z.object({
  message: z.string().min(1).max(10000),
  final: z.boolean().default(false),
});

/**
 * POST /api/tasks/:taskId/reply — Reply to a task from the UI.
 *
 * Session-authenticated. The task owner (caller or callee) can send
 * messages to an active conversation. This is the UI counterpart of
 * the A2A `/call/:moltNumber/tasks/:taskId/reply` endpoint.
 *
 * Body: { message: string, final?: boolean }
 *   - message: plain text message
 *   - final: if true, marks the conversation as completed
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { taskId } = await params;
  let parsed: z.infer<typeof bodySchema>;
  try {
    const body = await req.json();
    parsed = bodySchema.parse(body);
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      callee: { select: { id: true, ownerId: true, moltNumber: true, displayName: true } },
      caller: { select: { id: true, ownerId: true, moltNumber: true, displayName: true } },
    },
  });

  if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Ownership check — caller OR callee owner can reply
  const callerOwnerId = task.caller?.ownerId;
  const calleeOwnerId = task.callee?.ownerId;
  if (calleeOwnerId !== session.user.id && callerOwnerId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Determine the role based on who is replying
  const isCallee = calleeOwnerId === session.user.id;
  const role = isCallee ? 'agent' : 'user';

  // Task must be in an active state
  const activeStatuses: string[] = [
    TaskStatus.submitted,
    TaskStatus.working,
    TaskStatus.input_required,
  ];
  if (!activeStatuses.includes(task.status)) {
    return NextResponse.json(
      { error: `Cannot reply to task in ${task.status} state` },
      { status: 400 }
    );
  }

  const parts = [{ type: 'text' as const, text: parsed.message }];
  const newStatus = parsed.final
    ? TaskStatus.completed
    : (task.status === TaskStatus.submitted ? TaskStatus.working : task.status);
  const seqNum = await prisma.taskEvent.count({ where: { taskId } }) + 1;

  await prisma.$transaction([
    prisma.taskMessage.create({
      data: {
        taskId,
        role,
        parts: asParts(parts),
        deliveryStatus: 'sent',
      },
    }),
    prisma.task.update({
      where: { id: taskId },
      data: { status: newStatus },
    }),
    prisma.taskEvent.create({
      data: {
        taskId,
        type: 'task.message',
        payload: { role, by: 'ui', userId: session.user.id },
        sequenceNumber: seqNum,
      },
    }),
  ]);

  // Publish to SSE subscribers (best-effort)
  const agentIds = [task.calleeId, task.callerId].filter(Boolean) as string[];
  publishTaskEvent(agentIds, {
    eventId: `${taskId}-${seqNum}`,
    taskId,
    type: 'task.message',
    payload: { role, by: 'ui' },
    task: {
      id: taskId,
      status: newStatus,
      intent: task.intent,
      callee: task.callee ? { id: task.callee.id, moltNumber: task.callee.moltNumber, displayName: task.callee.displayName } : undefined,
      caller: task.caller ? { id: task.caller.id, moltNumber: task.caller.moltNumber, displayName: task.caller.displayName } : undefined,
    },
    timestamp: new Date().toISOString(),
    sequenceNumber: seqNum,
  }).catch(() => {});

  return NextResponse.json({ ok: true, id: taskId, status: newStatus });
}
