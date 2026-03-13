/**
 * POST /api/agents/:id/delegate
 *
 * Delegate a call to a target agent on behalf of one of the owner's agents.
 * The delegated agent autonomously handles the conversation.
 *
 * Security invariant: The authenticated user MUST own the caller agent.
 * The target agent can be anyone (same as placing a normal call).
 * Conversation history is fetched server-side from trusted DB records
 * — never from client-supplied data.
 *
 * Body: {
 *   callerAgentId: string  — which of the user's agents should make the call
 *   instructions?: string  — what the delegated agent should do
 *   intent: "call" | "text"
 *   includeHistory?: boolean — include recent conversation with the target
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { TaskStatus } from '@prisma/client';
import { POST as taskSendHandler } from '@/app/call/[moltNumber]/tasks/send/route';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id: targetAgentId } = await params;

  // Validate target agent exists
  const targetAgent = await prisma.agent.findUnique({
    where: { id: targetAgentId, isActive: true },
    select: { moltNumber: true, displayName: true },
  });
  if (!targetAgent) return NextResponse.json({ error: 'Target agent not found' }, { status: 404 });

  const body = await req.json();
  const callerAgentId = body.callerAgentId;
  const instructions = body.instructions?.trim() || '';
  const rawIntent = body.intent;
  if (typeof rawIntent !== 'string' || !rawIntent) {
    return NextResponse.json({ error: 'intent is required — must be a non-empty string (e.g. "call", "text")' }, { status: 400 });
  }
  const intent = rawIntent;
  const includeHistory = body.includeHistory === true;

  if (!callerAgentId) {
    return NextResponse.json({ error: 'callerAgentId is required' }, { status: 400 });
  }

  // ── Security: caller agent MUST belong to the authenticated user ──
  const callerAgent = await prisma.agent.findUnique({
    where: { id: callerAgentId, isActive: true },
    select: { id: true, moltNumber: true, displayName: true, ownerId: true },
  });
  if (!callerAgent) return NextResponse.json({ error: 'Caller agent not found' }, { status: 404 });
  if (callerAgent.ownerId !== session.user.id) {
    return NextResponse.json({ error: 'You do not own this agent' }, { status: 403 });
  }

  // Prevent self-delegation
  if (callerAgentId === targetAgentId) {
    return NextResponse.json({ error: 'An agent cannot delegate a call to itself' }, { status: 400 });
  }

  const taskId = randomUUID();
  const sessionId = randomUUID();

  // ── Build conversation context (server-side, from trusted DB) ──
  // If includeHistory is true, fetch the most recent task between any of the
  // user's agents and the target agent. We verify ownership via the caller's
  // ownerId — attacker cannot include someone else's conversation.
  let historyContext = '';
  if (includeHistory) {
    // Find the user's agent IDs to scope the history to owned conversations only
    const userAgentIds = await prisma.agent.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true },
    });
    const ownedIds = userAgentIds.map(a => a.id);

    const recentTask = await prisma.task.findFirst({
      where: {
        calleeId: targetAgentId,
        callerId: { in: ownedIds },
        status: { in: [TaskStatus.working, TaskStatus.completed, TaskStatus.input_required] },
      },
      orderBy: { updatedAt: 'desc' },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 50 } },
    });

    if (recentTask && recentTask.messages.length > 0) {
      const lines = recentTask.messages.map(m => {
        const parts = (Array.isArray(m.parts) ? m.parts : []) as Array<{ type?: string; text?: string }>;
        const text = parts.filter(p => p.type === 'text').map(p => p.text || '').join('\n');
        return `[${m.role}]: ${text}`;
      });
      historyContext = `\n\n--- Previous conversation with ${targetAgent.displayName} ---\n${lines.join('\n')}\n--- End of previous conversation ---\n\n`;
    }
  }

  // Build the message: instructions + optional history context
  const messageText = instructions
    ? `${historyContext}${instructions}`
    : `${historyContext}Hello, this is ${callerAgent.displayName}. I'd like to connect.`;

  // Build A2A task payload — the caller identity is the delegated agent
  const taskPayload = {
    id: taskId,
    sessionId,
    message: {
      role: 'user',
      parts: [{ type: 'text', text: messageText }],
    },
    metadata: {
      'molt.intent': intent,
      'molt.caller': callerAgent.moltNumber,
      'molt.delegated': true,
      'molt.delegated_by': session.user.id,
    },
  };

  // Call the tasks/send route handler directly (no HTTP self-fetch).
  // Cloudflare Workers block self-referencing fetches on custom domains.
  const syntheticHeaders = new Headers({
    'Content-Type': 'application/json',
    'X-Molt-Caller': callerAgent.moltNumber,
  });
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) syntheticHeaders.set('x-forwarded-for', fwd);
  const realIp = req.headers.get('x-real-ip');
  if (realIp) syntheticHeaders.set('x-real-ip', realIp);

  const syntheticReq = new NextRequest(
    new URL(`/call/${targetAgent.moltNumber}/tasks/send`, req.nextUrl.origin),
    { method: 'POST', headers: syntheticHeaders, body: JSON.stringify(taskPayload) },
  );

  try {
    const callRes = await taskSendHandler(syntheticReq, {
      params: Promise.resolve({ moltNumber: targetAgent.moltNumber }),
    });

    const callData = await callRes.json();

    return NextResponse.json({
      taskId,
      sessionId,
      callerAgent: {
        id: callerAgent.id,
        displayName: callerAgent.displayName,
        moltNumber: callerAgent.moltNumber,
      },
      targetAgent: {
        displayName: targetAgent.displayName,
        moltNumber: targetAgent.moltNumber,
      },
      intent,
      includeHistory: includeHistory && historyContext.length > 0,
      status: callRes.status,
      response: callData,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[delegate] direct handler call failed:', detail);
    return NextResponse.json({ error: 'Failed to reach target agent', detail }, { status: 502 });
  }
}
