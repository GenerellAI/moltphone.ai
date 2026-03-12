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
  inbound: policyInSchema.optional(),
  outbound: policyOutSchema.optional(),
}).strict();

/**
 * GET /api/settings/call-policy — fetch global call policies
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { globalCallPolicyIn: true, globalCallPolicyOut: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const inbound: CallPolicyIn = parsePolicyIn(user.globalCallPolicyIn) ?? DEFAULT_POLICY_IN;
  const outbound: CallPolicyOut = parsePolicyOut(user.globalCallPolicyOut) ?? DEFAULT_POLICY_OUT;

  return NextResponse.json({ inbound, outbound });
}

/**
 * PATCH /api/settings/call-policy — update global call policies
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json();
    const data = patchSchema.parse(body);

    const update: Record<string, unknown> = {};

    if (data.inbound) {
      const current = parsePolicyIn(
        (await prisma.user.findUnique({ where: { id: session.user.id }, select: { globalCallPolicyIn: true } }))?.globalCallPolicyIn
      ) ?? DEFAULT_POLICY_IN;
      update.globalCallPolicyIn = { ...current, ...data.inbound } satisfies CallPolicyIn;
    }
    if (data.outbound) {
      const current = parsePolicyOut(
        (await prisma.user.findUnique({ where: { id: session.user.id }, select: { globalCallPolicyOut: true } }))?.globalCallPolicyOut
      ) ?? DEFAULT_POLICY_OUT;
      update.globalCallPolicyOut = { ...current, ...data.outbound } satisfies CallPolicyOut;
    }

    await prisma.user.update({ where: { id: session.user.id }, data: update });

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { globalCallPolicyIn: true, globalCallPolicyOut: true },
    });

    return NextResponse.json({
      inbound: parsePolicyIn(user?.globalCallPolicyIn) ?? DEFAULT_POLICY_IN,
      outbound: parsePolicyOut(user?.globalCallPolicyOut) ?? DEFAULT_POLICY_OUT,
    });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
