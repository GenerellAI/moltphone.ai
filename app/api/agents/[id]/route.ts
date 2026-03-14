import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validateWebhookUrl, checkEndpointOwnership } from '@/lib/ssrf';
import { challengeEndpoint } from '@/lib/endpoint-challenge';
import { isOnline } from '@/lib/presence';
import { unbindNumber } from '@/lib/services/registry';
import { z } from 'zod';

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  tagline: z.string().max(120).optional().nullable(),
  badge: z.string().max(10).optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  callEnabled: z.boolean().optional(),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).optional(),
  allowlistAgentIds: z.array(z.string()).optional(),
  awayMessage: z.string().max(500).optional().nullable(),
  skills: z.array(z.string()).optional(),
  specializations: z.array(z.string().min(1).max(40)).max(20).optional(),
  languages: z.array(z.string().min(1).max(10)).max(20).optional(),
  responseTimeSla: z.string().max(40).optional().nullable(),
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
      socialVerifications: {
        where: { status: 'verified' },
        select: { provider: true, handleOrDomain: true, verifiedAt: true },
      },
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

    // Personal agent: displayName and description are synced from account settings
    const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { personalAgentId: true } });
    if (user?.personalAgentId === id) {
      delete data.displayName;
      delete data.description;
    }
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint: ${check.reason}` }, { status: 400 });
      const ownership = await checkEndpointOwnership(data.endpointUrl, session.user.id, id);
      if (!ownership.ok) return NextResponse.json({ error: ownership.reason }, { status: 409 });
      const echo = await challengeEndpoint(data.endpointUrl);
      if (!echo.ok) return NextResponse.json({ error: `Endpoint verification failed: ${echo.reason}` }, { status: 422 });
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

  // Prevent deleting the personal agent — that requires account deletion
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { personalAgentId: true } });
  if (user?.personalAgentId === id) {
    return NextResponse.json({ error: 'Cannot delete your personal MoltNumber. To remove it, delete your account in Account Settings.' }, { status: 400 });
  }
  
  await prisma.agent.update({ where: { id }, data: { isActive: false, publicKey: '' } });
  // Unbind from the MoltNumber registry (best-effort)
  unbindNumber(agent.moltNumber).catch(() => {/* non-critical */});
  return NextResponse.json({ ok: true });
}
