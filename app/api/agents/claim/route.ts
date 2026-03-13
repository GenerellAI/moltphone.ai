/**
 * POST /api/agents/claim — Human claims an unclaimed agent.
 *
 * Requires an authenticated session (user must be logged in).
 * The claim token was given to the agent at self-signup;
 * the agent sends it to its human owner via the claim URL.
 *
 * For org nations: if the claiming user is an owner, admin, or member
 * of the nation, the agent is auto-approved (callEnabled=true) and
 * a registration certificate + registry binding are issued immediately.
 * Otherwise, the agent stays callEnabled=false until a nation admin approves.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canCreateAgent, deductAgentCreationCredits, AGENT_CREATION_COST } from '@/lib/services/credits';
import { sendClaimNotificationEmail } from '@/lib/email';
import { isNationAdmin } from '@/lib/nation-admin';
import { issueRegistrationCertificate } from '@/lib/carrier-identity';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';
import { z } from 'zod';

const claimSchema = z.object({
  claimToken: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized — please log in first.' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { claimToken } = claimSchema.parse(body);

    // Find the unclaimed agent
    const agent = await prisma.agent.findFirst({
      where: {
        claimToken,
        ownerId: { equals: null },
        isActive: true,
      },
    });

    if (!agent) {
      return NextResponse.json(
        { error: 'Invalid or already-claimed token.' },
        { status: 404 },
      );
    }

    // Check expiry
    if (agent.claimExpiresAt && agent.claimExpiresAt < new Date()) {
      // Auto-deactivate expired unclaimed agent
      await prisma.agent.update({
        where: { id: agent.id },
        data: { isActive: false },
      });
      return NextResponse.json(
        { error: 'This claim link has expired. The agent must sign up again.' },
        { status: 410 },
      );
    }

    // Verify email
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { emailVerifiedAt: true, email: true, name: true },
    });
    if (!user?.emailVerifiedAt) {
      return NextResponse.json(
        { error: 'Please verify your email before claiming agents.' },
        { status: 403 },
      );
    }

    // Sybil guards: quota + cooldown + credit balance
    const guard = await canCreateAgent(session.user.id);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.reason }, { status: 403 });
    }

    // Atomic: deduct credits + claim agent in a transaction
    // Prevents credits being lost if the agent update fails
    await prisma.$transaction(async (tx) => {
      // Deduct agent creation credits
      const deduction = await deductAgentCreationCredits(session.user!.id, agent.moltNumber);
      if (!deduction.ok) {
        throw new InsufficientCreditsError();
      }

      // Check if this is an org nation (needs admin approval before full activation)
      const agentNation = await tx.nation.findUnique({
        where: { code: agent.nationCode },
        select: { type: true, ownerId: true, adminUserIds: true, memberUserIds: true },
      });
      const isOrgNation = agentNation?.type === 'org';

      // For org nations, auto-approve if the claiming user is an owner, admin, or member
      const isOrgMember = isOrgNation && agentNation && (
        isNationAdmin(agentNation as { ownerId: string; adminUserIds?: string[] }, session.user!.id) ||
        (agentNation.memberUserIds as string[] || []).includes(session.user!.id)
      );

      // Claim the agent: assign owner, clear claim token.
      // For org nations where user is NOT a member: keep callEnabled=false (admin must approve).
      // For org nations where user IS a member: auto-approve, enable immediately.
      // For open nations: enable calling immediately.
      await tx.agent.update({
        where: { id: agent.id },
        data: {
          ownerId: session.user!.id,
          claimedAt: new Date(),
          claimToken: { set: null },
          claimExpiresAt: { set: null },
          callEnabled: (isOrgNation && !isOrgMember) ? false : true,
        },
      });
    });

    // Check if org nation for response message
    const agentNation = await prisma.nation.findUnique({
      where: { code: agent.nationCode },
      select: { type: true, displayName: true, ownerId: true, adminUserIds: true, memberUserIds: true },
    });
    const isOrgNation = agentNation?.type === 'org';
    const isOrgMember = isOrgNation && agentNation && (
      isNationAdmin(agentNation as { ownerId: string; adminUserIds?: string[] }, session.user!.id) ||
      (agentNation.memberUserIds as string[] || []).includes(session.user!.id)
    );
    const needsOrgApproval = isOrgNation && !isOrgMember;

    // For org members: idempotent re-issue of cert + registry binding (auto-approved).
    // Signup already issues these, but re-issue here as defense-in-depth in case
    // the signup's best-effort binding failed. bindNumber uses upsert, so it's safe.
    if (isOrgNation && isOrgMember) {
      bindNumber({
        moltNumber: agent.moltNumber,
        carrierDomain: getCarrierDomain(),
        nationCode: agent.nationCode,
      }).catch(() => {/* non-critical */});

      if (agent.publicKey) {
        issueRegistrationCertificate({
          moltNumber: agent.moltNumber,
          agentPublicKey: agent.publicKey,
          nationCode: agent.nationCode,
        });
      }
    }

    // Send claim notification email (fire-and-forget, don't block response)
    if (user.email) {
      sendClaimNotificationEmail(
        user.email,
        agent.displayName,
        agent.moltNumber,
        agent.nationCode,
        user.name,
      ).catch((err) => console.error('[claim] Failed to send notification email:', err));
    }

    return NextResponse.json({
      ok: true,
      agent: {
        id: agent.id,
        moltNumber: agent.moltNumber,
        displayName: agent.displayName,
        nationCode: agent.nationCode,
      },
      message: needsOrgApproval
        ? `Successfully claimed ${agent.displayName} (${agent.moltNumber}). The agent still needs approval from the ${agentNation!.displayName} nation owner before it can operate.`
        : `Successfully claimed ${agent.displayName} (${agent.moltNumber}). The agent can now call out.`,
      ...(needsOrgApproval ? { pendingOrgApproval: true } : {}),
    });
  } catch (e) {
    if (e instanceof InsufficientCreditsError) {
      return NextResponse.json(
        { error: `Insufficient credits. Claiming an agent costs ${AGENT_CREATION_COST} credits.` },
        { status: 402 },
      );
    }
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues }, { status: 400 });
    }
    console.error('[POST /api/agents/claim]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** Sentinel error thrown inside $transaction for insufficient credits. */
class InsufficientCreditsError extends Error {
  constructor() {
    super('Insufficient credits');
    this.name = 'InsufficientCreditsError';
  }
}
