import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import {
  canCreateNation,
  deductNationCreationCredits,
  BLOCKED_NATION_CODES,
  CLAIMABLE_NATION_DOMAINS,
  RESERVED_NATION_CODES,
  NATION_CREATION_COST,
  NATION_PROVISIONAL_DAYS,
} from '@/lib/services/credits';

const createSchema = z.object({
  code: z.string().regex(/^[A-Z]{4}$/, 'Nation code must be 4 uppercase letters'),
  type: z.enum(['open', 'org']).default('open'),
  displayName: z.string().min(1).max(100),
  description: z.string().min(1, 'Description is required').max(500),
  badge: z.string().max(10).optional(),
  isPublic: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  
  const nations = await prisma.nation.findMany({
    where: {
      isActive: true,
      ...(q ? {
        OR: [
          { code: { contains: q.toUpperCase() } },
          { displayName: { contains: q, mode: 'insensitive' as const } },
        ]
      } : undefined),
    },
    include: {
      _count: { select: { agents: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { code: 'asc' },
  });
  
  return NextResponse.json(nations);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    
    // 1. Reserved code check
    if (BLOCKED_NATION_CODES.includes(data.code)) {
      return NextResponse.json(
        { error: `${data.code} is a reserved system code and cannot be created` },
        { status: 400 },
      );
    }

    // 1b. Claimable reserved codes require domain verification after creation
    const claimableDomain = CLAIMABLE_NATION_DOMAINS[data.code];
    // claimableDomain === '' means country code (blocked)
    if (claimableDomain === '') {
      return NextResponse.json(
        { error: `${data.code} is a reserved nation code` },
        { status: 400 },
      );
    }
    
    // 2. Full Sybil resistance: verified email + quota + cooldown + credits
    const guard = await canCreateNation(session.user.id);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.reason }, { status: 403 });
    }

    // 3. Uniqueness check
    const existing = await prisma.nation.findUnique({ where: { code: data.code } });
    if (existing) return NextResponse.json({ error: 'Nation code already taken' }, { status: 409 });
    
    // 4. Create nation with provisional status
    const provisionalUntil = new Date();
    provisionalUntil.setDate(provisionalUntil.getDate() + NATION_PROVISIONAL_DAYS);

    // Claimable reserved codes start private until domain is verified
    const isClaimable = !!claimableDomain;

    const nation = await prisma.nation.create({
      data: {
        ...data,
        isPublic: isClaimable ? false : data.isPublic,
        ownerId: session.user.id,
        provisionalUntil,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { agents: true } },
      },
    });

    // 5. Deduct credits (after creation to allow rollback)
    const deduction = await deductNationCreationCredits(session.user.id, data.code);
    if (!deduction.ok) {
      // Rollback: delete the nation we just created
      await prisma.nation.delete({ where: { id: nation.id } });
      return NextResponse.json(
        { error: `Insufficient credits. Nation creation costs ${NATION_CREATION_COST} credits.` },
        { status: 402 },
      );
    }

    return NextResponse.json({
      ...nation,
      creditsDeducted: NATION_CREATION_COST,
      creditsRemaining: deduction.balance,
      ...(isClaimable ? { requiredDomain: claimableDomain, domainVerificationRequired: true } : {}),
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
