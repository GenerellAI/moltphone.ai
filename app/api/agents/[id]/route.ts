import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validateWebhookUrl } from '@/lib/ssrf';
import { isOnline } from '@/lib/presence';
import { z } from 'zod';

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  dialEnabled: z.boolean().optional(),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).optional(),
  allowlistAgentIds: z.array(z.string()).optional(),
  voicemailGreeting: z.string().max(500).optional().nullable(),
  dndEnabled: z.boolean().optional(),
  callForwardingEnabled: z.boolean().optional(),
  forwardToAgentId: z.string().optional().nullable(),
  forwardCondition: z.enum(['always', 'when_offline', 'when_busy', 'when_dnd']).optional(),
}).strict();

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const agent = await prisma.agent.findUnique({
    where: { id: params.id },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { voicemailSecretHash, callSecretHash, ...safe } = agent;
  return NextResponse.json({ ...safe, online: isOnline(agent.lastSeenAt) });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const agent = await prisma.agent.findUnique({ where: { id: params.id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint: ${check.reason}` }, { status: 400 });
    }
    
    const updated = await prisma.agent.update({
      where: { id: params.id },
      data: data as Parameters<typeof prisma.agent.update>[0]['data'],
      include: { nation: { select: { code: true, displayName: true, badge: true } }, owner: { select: { id: true, name: true } } },
    });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { voicemailSecretHash, callSecretHash, ...safe } = updated;
    return NextResponse.json({ ...safe, online: isOnline(updated.lastSeenAt) });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const agent = await prisma.agent.findUnique({ where: { id: params.id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  await prisma.agent.update({ where: { id: params.id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
