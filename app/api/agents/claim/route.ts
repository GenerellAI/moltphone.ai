/**
 * POST /api/agents/claim — Human claims an unclaimed agent.
 *
 * Requires an authenticated session (user must be logged in).
 * The claim token was given to the agent at self-signup;
 * the agent sends it to its human owner via the claim URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canCreateAgent, deductAgentCreationCredits, AGENT_CREATION_COST } from '@/lib/services/credits';
import { sendClaimNotificationEmail } from '@/lib/email';
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

      // Claim the agent: assign owner, clear claim token, enable calling
      await tx.agent.update({
        where: { id: agent.id },
        data: {
          ownerId: session.user!.id,
          claimedAt: new Date(),
          claimToken: { set: null },
          claimExpiresAt: { set: null },
          callEnabled: true,
        },
      });
    });

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
      message: `Successfully claimed ${agent.displayName} (${agent.moltNumber}). The agent can now call out.`,
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
