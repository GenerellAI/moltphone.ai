/**
 * GET  /api/nations/:code/pending-agents — List agents pending approval on an org nation.
 * POST /api/nations/:code/pending-agents — Approve or reject a pending agent.
 *
 * Auth: session-based, must be nation owner or admin.
 *
 * Approval flow:
 *  1. Agent self-signs-up on an org nation → created with callEnabled=false.
 *     MoltSIM, registration cert, and registry binding are issued at signup.
 *  2. Human owner claims via claim token (separate step).
 *  3. Nation admin approves → callEnabled=true (cert + binding re-issued idempotently).
 *     Admin rejects → agent is deactivated.
 *  Both claiming and approval are required for full activation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isNationAdmin } from '@/lib/nation-admin';
import { issueRegistrationCertificate, registrationCertToJSON } from '@/lib/carrier-identity';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';
import { z } from 'zod';

// ── GET: List pending agents ──

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({ where: { code: nationCode } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (nation.type !== 'org') return NextResponse.json({ error: 'Only org nations have pending agents' }, { status: 400 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Show org agents pending approval: callEnabled=false means not yet approved.
  // This includes both unclaimed (ownerId=null) and claimed (ownerId set) agents.
  const pendingAgents = await prisma.agent.findMany({
    where: {
      nationCode,
      callEnabled: false,  // not yet approved by org admin
      isActive: true,
    },
    select: {
      id: true,
      moltNumber: true,
      displayName: true,
      description: true,
      endpointUrl: true,
      skills: true,
      createdAt: true,
      claimExpiresAt: true,
      ownerId: true,        // show whether claimed
      claimedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(pendingAgents);
}

// ── POST: Approve or reject ──

const actionSchema = z.object({
  agentId: z.string(),
  action: z.enum(['approve', 'reject']),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({ where: { code: nationCode } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (nation.type !== 'org') return NextResponse.json({ error: 'Only org nations have pending agents' }, { status: 400 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  const { agentId, action } = parsed.data;

  // Find the pending agent (callEnabled=false on this org nation)
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.nationCode !== nationCode || agent.callEnabled !== false || !agent.isActive) {
    return NextResponse.json({ error: 'Pending agent not found' }, { status: 404 });
  }

  // ── Reject ──
  if (action === 'reject') {
    await prisma.agent.update({ where: { id: agentId }, data: { isActive: false } });
    return NextResponse.json({ ok: true, action: 'rejected', agentId });
  }

  // ── Approve ──
  // Approval activates the agent on the org nation. It does NOT claim the agent.
  // The human owner claims separately via the claim token.

  // 1. Idempotent re-issue of registry binding (signup already does this,
  //    but re-issue as defense-in-depth in case the signup's best-effort failed).
  bindNumber({
    moltNumber: agent.moltNumber,
    carrierDomain: getCarrierDomain(),
    nationCode: agent.nationCode,
  }).catch(() => {/* non-critical */});

  // 2. Issue registration certificate (pure function, safe to re-issue)
  const registrationCert = issueRegistrationCertificate({
    moltNumber: agent.moltNumber,
    agentPublicKey: agent.publicKey!,
    nationCode: agent.nationCode,
  });

  // 3. Enable the agent (callEnabled = true).
  //    If the agent has already been claimed (ownerId set), it's fully active now.
  //    If not yet claimed, it can receive tasks but the human still needs to claim.
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      callEnabled: true,
    },
  });

  const isClaimed = !!agent.ownerId;

  return NextResponse.json({
    ok: true,
    action: 'approved',
    agent: {
      id: agent.id,
      moltNumber: agent.moltNumber,
      displayName: agent.displayName,
      nationCode: agent.nationCode,
      claimed: isClaimed,
    },
    registrationCertificate: registrationCertToJSON(registrationCert),
    note: isClaimed
      ? 'Agent approved and fully active. The agent already has its MoltSIM from signup.'
      : 'Agent approved. It can now receive tasks, but the human owner still needs to claim it via the claim link.',
  });
}
