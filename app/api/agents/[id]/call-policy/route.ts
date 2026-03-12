import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  parsePolicyIn,
  parsePolicyOut,
  DEFAULT_POLICY_IN,
  DEFAULT_POLICY_OUT,
  type CallPolicyIn,
  type CallPolicyOut,
} from '@/lib/call-policy';
import { z } from 'zod';

const verificationProviders = ['x', 'github', 'domain'] as const;

const policyInSchema = z.object({
  allowedNations: z.array(z.string().min(1).max(10)).max(100).optional(),
  blockedNations: z.array(z.string().min(1).max(10)).max(100).optional(),
  requiredVerifications: z.array(z.enum(verificationProviders)).optional(),
  allowAnonymous: z.boolean().optional(),
  contactsOnly: z.boolean().optional(),
  allowlist: z.array(z.string()).max(500).optional(),
  blocklist: z.array(z.string()).max(500).optional(),
  minAgentAgeDays: z.number().int().min(0).max(365).optional(),
  maxCallsPerHourPerCaller: z.number().int().min(0).max(1000).optional(),
}).strict();

const policyOutSchema = z.object({
  allowedNations: z.array(z.string().min(1).max(10)).max(100).optional(),
  contactsOnly: z.boolean().optional(),
  verifiedOnly: z.boolean().optional(),
  requireConfirmation: z.boolean().optional(),
}).strict();

const patchSchema = z.object({
  inbound: policyInSchema.nullable().optional(),
  outbound: policyOutSchema.nullable().optional(),
}).strict();

/**
 * GET /api/agents/:id/call-policy — get agent's resolved policy
 *
 * Returns the effective policy (agent-level if set, otherwise global, otherwise default)
 * plus whether each direction is using a custom override or inheriting.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    select: { ownerId: true, callPolicyIn: true, callPolicyOut: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { globalCallPolicyIn: true, globalCallPolicyOut: true },
  });

  const agentIn = parsePolicyIn(agent.callPolicyIn);
  const agentOut = parsePolicyOut(agent.callPolicyOut);
  const globalIn = parsePolicyIn(user?.globalCallPolicyIn) ?? DEFAULT_POLICY_IN;
  const globalOut = parsePolicyOut(user?.globalCallPolicyOut) ?? DEFAULT_POLICY_OUT;

  return NextResponse.json({
    inbound: agentIn ?? globalIn,
    outbound: agentOut ?? globalOut,
    inboundOverridden: !!agentIn,
    outboundOverridden: !!agentOut,
    global: { inbound: globalIn, outbound: globalOut },
  });
}

/**
 * PATCH /api/agents/:id/call-policy — set agent-level policy override
 *
 * Send `{ inbound: {...} }` to override, or `{ inbound: null }` to reset to global.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    select: { ownerId: true, callPolicyIn: true, callPolicyOut: true },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const data = patchSchema.parse(body);

    const update: Record<string, unknown> = {};

    if (data.inbound === null) {
      // Reset to global
      update.callPolicyIn = null;
    } else if (data.inbound) {
      const current = parsePolicyIn(agent.callPolicyIn) ?? DEFAULT_POLICY_IN;
      update.callPolicyIn = { ...current, ...data.inbound } satisfies CallPolicyIn;
    }

    if (data.outbound === null) {
      update.callPolicyOut = null;
    } else if (data.outbound) {
      const current = parsePolicyOut(agent.callPolicyOut) ?? DEFAULT_POLICY_OUT;
      update.callPolicyOut = { ...current, ...data.outbound } satisfies CallPolicyOut;
    }

    await prisma.agent.update({ where: { id }, data: update });

    // Re-fetch and return the resolved policy
    const [updatedAgent, user] = await Promise.all([
      prisma.agent.findUnique({ where: { id }, select: { callPolicyIn: true, callPolicyOut: true } }),
      prisma.user.findUnique({ where: { id: session.user.id }, select: { globalCallPolicyIn: true, globalCallPolicyOut: true } }),
    ]);

    const agentIn = parsePolicyIn(updatedAgent?.callPolicyIn);
    const agentOut = parsePolicyOut(updatedAgent?.callPolicyOut);
    const globalIn = parsePolicyIn(user?.globalCallPolicyIn) ?? DEFAULT_POLICY_IN;
    const globalOut = parsePolicyOut(user?.globalCallPolicyOut) ?? DEFAULT_POLICY_OUT;

    return NextResponse.json({
      inbound: agentIn ?? globalIn,
      outbound: agentOut ?? globalOut,
      inboundOverridden: !!agentIn,
      outboundOverridden: !!agentOut,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
