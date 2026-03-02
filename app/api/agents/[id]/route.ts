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
  awayMessage: z.string().max(500).optional().nullable(),
  skills: z.array(z.string()).optional(),
  dndEnabled: z.boolean().optional(),
  callForwardingEnabled: z.boolean().optional(),
  forwardToAgentId: z.string().optional().nullable(),
  forwardCondition: z.enum(['always', 'when_offline', 'when_busy', 'when_dnd']).optional(),
  maxConcurrentCalls: z.number().int().min(1).max(100).optional(),
  directConnectionPolicy: z.enum(['direct_on_consent', 'direct_on_accept', 'carrier_only']).optional(),
  pushEndpointUrl: z.string().url().optional().nullable(),
}).strict();

/** MoltPage — public view, no sensitive fields */
function toMoltPage(agent: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { endpointUrl: _eu, publicKey: _pk, allowlistAgentIds: _al, ...rest } = agent as {
    endpointUrl?: unknown; publicKey?: unknown; allowlistAgentIds?: unknown;
    [k: string]: unknown;
  };
  return rest;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  return NextResponse.json({ ...toMoltPage(agent), online: isOnline(agent.lastSeenAt) });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint: ${check.reason}` }, { status: 400 });
    }
    if (data.pushEndpointUrl) {
      const check = await validateWebhookUrl(data.pushEndpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid push endpoint: ${check.reason}` }, { status: 400 });
    }
    
    const updated = await prisma.agent.update({
      where: { id },
      data: data as Parameters<typeof prisma.agent.update>[0]['data'],
      include: { nation: { select: { code: true, displayName: true, badge: true } }, owner: { select: { id: true, name: true } } },
    });
    return NextResponse.json({ ...toMoltPage(updated), online: isOnline(updated.lastSeenAt) });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  await prisma.agent.update({ where: { id }, data: { isActive: false } });
  return NextResponse.json({ ok: true });
}
