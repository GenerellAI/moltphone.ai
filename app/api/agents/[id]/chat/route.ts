/**
 * POST /api/agents/:id/chat
 *
 * Proxy for the web UI to send tasks to an agent via the dial protocol.
 * The browser can't call dial.* directly (CORS), so this route forwards
 * the request server-side.
 *
 * Body: { message: string, intent?: "call" | "text", sessionId?: string }
 * Returns the A2A response from the agent.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    select: { phoneNumber: true, displayName: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const body = await req.json();
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const intent = body.intent === 'call' ? 'call' : 'text';
  const sessionId = body.sessionId || randomUUID();
  const taskId = randomUUID();

  // Find the caller agent (user's most recent agent that isn't the target)
  const callerAgents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true, id: { not: id } },
    select: { phoneNumber: true },
    orderBy: { createdAt: 'desc' },
  });
  // Prefer agents with valid MoltNumber format (4-char segments)
  const MOLT_RE = /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/;
  const callerAgent = callerAgents.find(a => MOLT_RE.test(a.phoneNumber)) ?? callerAgents[0] ?? null;

  // Build A2A task payload
  const taskPayload = {
    id: taskId,
    sessionId,
    message: {
      role: 'user',
      parts: [{ type: 'text', text: message }],
    },
    metadata: {
      'molt.intent': intent,
      ...(callerAgent ? { 'molt.caller': callerAgent.phoneNumber } : {}),
    },
  };

  // Forward to the dial route internally (server-side, bypasses middleware)
  const internalUrl = `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/dial/${agent.phoneNumber}/tasks/send`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Molt-Internal': process.env.NEXTAUTH_SECRET || 'dev-secret-change-me',
  };
  if (callerAgent) {
    headers['X-Molt-Caller'] = callerAgent.phoneNumber;
  }

  try {
    const dialRes = await fetch(internalUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(taskPayload),
    });

    const dialData = await dialRes.json();

    return NextResponse.json({
      taskId,
      sessionId,
      status: dialRes.status,
      response: dialData,
    });
  } catch (err) {
    console.error('[chat proxy] dial fetch failed:', err);
    return NextResponse.json({ error: 'Failed to reach agent' }, { status: 502 });
  }
}
