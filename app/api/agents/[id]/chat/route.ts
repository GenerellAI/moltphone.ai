/**
 * POST /api/agents/:id/chat
 *
 * Proxy for the web UI to send tasks to an agent via the call protocol.
 * The browser can't call call.* directly (CORS), so this route forwards
 * the request server-side.
 *
 * Body: { message: string, intent: "call" | "text", sessionId?: string }
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
    select: { moltNumber: true, displayName: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const body = await req.json();
  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: 'Message is required' }, { status: 400 });

  const rawIntent = body.intent;
  if (typeof rawIntent !== 'string' || !rawIntent) {
    return NextResponse.json({ error: 'intent is required — must be a non-empty string (e.g. "call", "text")' }, { status: 400 });
  }
  const intent = rawIntent;
  const sessionId = body.sessionId || randomUUID();
  const taskId = randomUUID();

  // Use the user's personal agent as the caller identity.
  // The session carries personalAgentId/personalMoltNumber from auth.
  // Self-calls (personal agent calling itself) are valid — like calling your own voicemail.
  const user = session.user as { id: string; personalAgentId?: string | null; personalMoltNumber?: string | null };
  let callerNumber = user.personalMoltNumber ?? null;

  // Fallback: if session doesn't have personalMoltNumber, look it up
  if (!callerNumber && user.personalAgentId) {
    const pa = await prisma.agent.findUnique({
      where: { id: user.personalAgentId, isActive: true },
      select: { moltNumber: true },
    });
    callerNumber = pa?.moltNumber ?? null;
  }

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
      ...(callerNumber ? { 'molt.caller': callerNumber } : {}),
    },
  };

  // Forward to the call route internally (server-side, bypasses middleware).
  // Use the request's own origin so the fetch stays within the same worker/process.
  // NEXTAUTH_URL may point externally, which fails on Cloudflare Workers (self-fetch loop).
  const origin = req.nextUrl.origin;
  const internalUrl = `${origin}/call/${agent.moltNumber}/tasks/send`;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Molt-Internal': process.env.NEXTAUTH_SECRET || 'dev-secret-change-me',
  };
  if (callerNumber) {
    headers['X-Molt-Caller'] = callerNumber;
  }

  try {
    const callRes = await fetch(internalUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(taskPayload),
    });

    const callData = await callRes.json();

    // Pass sessionId from the call response — the task/send route may return
    // a sessionId that maps to the persistent multi-turn conversation.
    const returnedSessionId = callData.sessionId || sessionId;

    // Extract the database task ID (cuid).
    // - Success path: callData.id (top-level, e.g. { id: "cuid...", status: "working" })
    // - Error path: callData.error.data.task_id (JSON-RPC error with task in data)
    const resolvedTaskId = callData.id
      || callData.error?.data?.task_id
      || taskId;

    return NextResponse.json({
      taskId: resolvedTaskId,
      sessionId: returnedSessionId,
      callerNumber,
      status: callRes.status,
      response: callData,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('[chat proxy] call fetch failed:', detail, '| URL:', internalUrl);
    return NextResponse.json({ error: 'Failed to reach agent', detail }, { status: 502 });
  }
}
