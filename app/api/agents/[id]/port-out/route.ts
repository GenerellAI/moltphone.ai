/**
 * POST   /api/agents/:id/port-out — Request port-out (owner-only)
 * GET    /api/agents/:id/port-out — Check port-out status (owner-only)
 * DELETE /api/agents/:id/port-out — Cancel pending port-out (owner-only)
 *
 * Only valid for open-type nations. Org/carrier nations are non-portable.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NUMBER_PORTABILITY } from '@/carrier.config';
import {
  requestPortOut,
  getAgentPortRequests,
  cancelPortOut,
  checkPortability,
} from '@/lib/services/number-portability';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const portOutSchema = z.object({
  toCarrierDomain: z.string().min(1).optional(),
});

// ── POST /api/agents/:id/port-out ────────────────────────

export async function POST(req: NextRequest, { params }: RouteContext) {
  if (!NUMBER_PORTABILITY) {
    return NextResponse.json({ error: 'Number portability is not enabled on this carrier' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: z.infer<typeof portOutSchema> = {};
  try {
    const raw = await req.json().catch(() => ({}));
    body = portOutSchema.parse(raw);
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
  }

  const result = await requestPortOut({
    agentId: id,
    toCarrierDomain: body.toCarrierDomain,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    portRequest: result.portRequest,
    message: `Port-out request created. The carrier has ${7} days to approve or object. After the grace period, the port will proceed automatically.`,
  }, { status: 201 });
}

// ── GET /api/agents/:id/port-out ─────────────────────────

export async function GET(req: NextRequest, { params }: RouteContext) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const portability = await checkPortability(id);
  const portRequests = await getAgentPortRequests(id);

  return NextResponse.json({
    portable: portability.portable,
    nationType: portability.nationType,
    reason: portability.reason,
    portRequests,
  });
}

// ── DELETE /api/agents/:id/port-out ──────────────────────

export async function DELETE(req: NextRequest, { params }: RouteContext) {
  if (!NUMBER_PORTABILITY) {
    return NextResponse.json({ error: 'Number portability is not enabled on this carrier' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Find the most recent pending port request for this agent
  const pending = await prisma.portRequest.findFirst({
    where: { agentId: id, status: 'pending' },
    orderBy: { requestedAt: 'desc' },
  });

  if (!pending) {
    return NextResponse.json({ error: 'No pending port-out request to cancel' }, { status: 404 });
  }

  const result = await cancelPortOut(pending.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, message: 'Port-out request cancelled' });
}
