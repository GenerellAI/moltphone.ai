import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const bodySchema = z.object({
  message: z.string().min(1),
  caller_id: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  const callerHeader = req.headers.get('x-moltphone-caller');
  
  if (agent.inboundPolicy === 'allowlist' && callerHeader) {
    if (!agent.allowlistAgentIds.includes(callerHeader)) {
      return NextResponse.json({ error: 'Caller not in allowlist' }, { status: 403 });
    }
  }
  if (agent.inboundPolicy === 'registered_only' && !callerHeader) {
    return NextResponse.json({ error: 'Caller ID required' }, { status: 403 });
  }
  
  let parsedBody: { message: string; caller_id?: string };
  try {
    parsedBody = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }
  
  const call = await prisma.call.create({
    data: {
      calleeId: agent.id,
      callerId: callerHeader || null,
      type: 'text',
      status: 'voicemail',
      body: parsedBody.message,
      messages: { create: { role: 'user', content: parsedBody.message } },
      voicemails: {
        create: {
          agentId: agent.id,
          fromNumber: callerHeader || null,
          body: parsedBody.message,
          greeting: agent.voicemailGreeting || null,
        },
      },
    },
  });
  
  return NextResponse.json({
    status: 'voicemail',
    call_id: call.id,
    greeting: agent.voicemailGreeting || null,
  });
}
