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
import { POST as taskSendHandler } from '@/app/call/[moltNumber]/tasks/send/route';

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

  // Call the tasks/send route handler directly (no HTTP self-fetch).
  // Cloudflare Workers block self-referencing fetches on custom domains (loop
  // protection), and even on workers.dev the subrequest is unreliable. Importing
  // and calling the handler directly avoids all network issues.
  const syntheticHeaders = new Headers({
    'Content-Type': 'application/json',
  });
  if (callerNumber) syntheticHeaders.set('X-Molt-Caller', callerNumber);
  // Forward client IP for rate-limiting in the target route
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) syntheticHeaders.set('x-forwarded-for', fwd);
  const realIp = req.headers.get('x-real-ip');
  if (realIp) syntheticHeaders.set('x-real-ip', realIp);

  const syntheticReq = new NextRequest(
    new URL(`/call/${agent.moltNumber}/tasks/send`, req.nextUrl.origin),
    { method: 'POST', headers: syntheticHeaders, body: JSON.stringify(taskPayload) },
  );

  try {
    const callRes = await taskSendHandler(syntheticReq, {
      params: Promise.resolve({ moltNumber: agent.moltNumber }),
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
    console.error('[chat proxy] direct handler call failed:', detail);
    return NextResponse.json({ error: 'Failed to reach agent', detail }, { status: 502 });
  }
}
