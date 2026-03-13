/**
 * GET  /api/nations/:code/pending-agents — List pending (unclaimed) agents on an org nation.
 * POST /api/nations/:code/pending-agents — Approve or reject a pending agent.
 *
 * Auth: session-based, must be nation owner or admin.
 *
 * Approval flow:
 *  1. Agent self-signs-up on an org nation → created inert (no MoltSIM/cert/registry).
 *  2. Nation owner views pending agents in settings.
 *  3. Owner approves → agent gets MoltSIM, registry binding, registration cert.
 *     Owner rejects → agent is deactivated.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isNationAdmin } from '@/lib/nation-admin';
import { issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON, getCarrierPublicKey } from '@/lib/carrier-identity';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';
import { CALL_BASE_URL, callUrl } from '@/lib/call-url';
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

  const pendingAgents = await prisma.agent.findMany({
    where: {
      nationCode,
      ownerId: null,       // unclaimed
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

  // Find the pending agent
  const agent = await prisma.agent.findUnique({ where: { id: agentId } });
  if (!agent || agent.nationCode !== nationCode || agent.ownerId !== null || !agent.isActive) {
    return NextResponse.json({ error: 'Pending agent not found' }, { status: 404 });
  }

  // ── Reject ──
  if (action === 'reject') {
    await prisma.agent.update({ where: { id: agentId }, data: { isActive: false } });
    return NextResponse.json({ ok: true, action: 'rejected', agentId });
  }

  // ── Approve ──
  // 1. Register the number with the MoltNumber registry
  bindNumber({
    moltNumber: agent.moltNumber,
    carrierDomain: getCarrierDomain(),
    nationCode: agent.nationCode,
  }).catch(() => {/* non-critical */});

  // 2. Issue registration certificate
  const registrationCert = issueRegistrationCertificate({
    moltNumber: agent.moltNumber,
    agentPublicKey: agent.publicKey!,
    nationCode: agent.nationCode,
  });

  // 3. Build the MoltSIM (note: private key is NOT stored in DB, so we
  //    cannot rebuild it. The agent will need to re-provision/claim to get
  //    a new MoltSIM with the private key. We mark it as approved so the
  //    claim flow works.)
  //    The approved agent now has callEnabled=false until claimed, but it
  //    CAN receive tasks (no longer inert).

  // We don't flip callEnabled here — that happens on claim.
  // The key change: the agent is no longer org-pending because we'll clear
  // the "inert" status by... well, the agent still has ownerId=null.
  // The simplest approach: since the org owner is approving, they become
  // a temporary "sponsor". We set a flag in the agent's metadata or,
  // better yet, we keep it simple: approved = ownerId set to the approver.
  // This makes the agent "claimed by the org owner" which is semantically correct.
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      ownerId: session.user.id,
      claimedAt: new Date(),
      // Clear claim token — no longer needed
      claimToken: null,
      claimExpiresAt: null,
    },
  });

  // Build MoltSIM-like response (without private key — agent must re-provision)
  const slug = agent.moltNumber;
  const moltsimPublic = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    molt_number: agent.moltNumber,
    nation_type: nation.type as 'carrier' | 'org' | 'open',
    carrier_call_base: CALL_BASE_URL,
    inbox_url: callUrl(slug, '/tasks'),
    task_reply_url: callUrl(slug, '/tasks/:id/reply'),
    task_cancel_url: callUrl(slug, '/tasks/:id/cancel'),
    presence_url: callUrl(slug, '/presence/heartbeat'),
    public_key: agent.publicKey,
    // private_key NOT included — agent must re-provision from the dashboard
    carrier_public_key: getCarrierPublicKey(),
    signature_algorithm: 'Ed25519',
    registration_certificate: registrationCertToJSON(registrationCert),
    carrier_certificate: getCarrierCertificateJSON(),
  };

  return NextResponse.json({
    ok: true,
    action: 'approved',
    agent: {
      id: agent.id,
      moltNumber: agent.moltNumber,
      displayName: agent.displayName,
      nationCode: agent.nationCode,
    },
    moltsim: moltsimPublic,
    registrationCertificate: registrationCertToJSON(registrationCert),
    note: 'Agent approved and claimed under your account. The agent can now receive tasks. To enable outbound calling, provision a new MoltSIM from the agent settings page.',
  });
}
