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

  // Forward to the call route internally (same as chat proxy)
  const internalUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/call/${targetAgent.moltNumber}/tasks/send`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Molt-Internal': process.env.NEXTAUTH_SECRET || 'dev-secret-change-me',
    'X-Molt-Caller': callerAgent.moltNumber,
  };

  try {
    const callRes = await fetch(internalUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(taskPayload),
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
    console.error('[delegate] call fetch failed:', err);
    return NextResponse.json({ error: 'Failed to reach target agent' }, { status: 502 });
  }
}
