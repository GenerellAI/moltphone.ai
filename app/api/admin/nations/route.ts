/**
 * GET    /api/admin/nations — List all nations with full details
 * POST   /api/admin/nations — Admin-create a nation (bypasses credits/quota/cooldown)
 * PATCH  /api/admin/nations — Admin-level nation update (ownership transfer, etc.)
 * DELETE /api/admin/nations — Admin-delete a nation (only if it has no agents)
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { z } from 'zod';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const nations = await prisma.nation.findMany({
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { agents: true } },
    },
    orderBy: { code: 'asc' },
  });

  return NextResponse.json(nations);
}

// ── Create ───────────────────────────────────────────────

const createSchema = z.object({
  code: z.string().regex(/^[A-Z]{4}$/, 'Nation code must be 4 uppercase letters'),
  type: z.enum(['open', 'org', 'carrier']).default('open'),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  badge: z.string().max(10).optional(),
  isPublic: z.boolean().default(true),
  ownerId: z.string().optional(),
}).strict();

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    // Uniqueness check
    const existing = await prisma.nation.findUnique({ where: { code: data.code } });
    if (existing) return NextResponse.json({ error: 'Nation code already taken' }, { status: 409 });

    // Resolve owner: specified or the admin themselves
    const ownerId = data.ownerId || auth.userId!;
    if (data.ownerId) {
      const targetUser = await prisma.user.findUnique({ where: { id: data.ownerId } });
      if (!targetUser) return NextResponse.json({ error: 'Owner user not found' }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { ownerId: _discardedOwnerId, ...nationData } = data;

    const nation = await prisma.nation.create({
      data: {
        ...nationData,
        ownerId,
        // Admin-created nations skip provisional status
        provisionalUntil: null,
      },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { agents: true } },
      },
    });

    return NextResponse.json(nation, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── Update ───────────────────────────────────────────────

const patchSchema = z.object({
  code: z.string().min(1),
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  badge: z.string().max(10).optional(),
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional(),
  type: z.enum(['open', 'org', 'carrier']).optional(),
  ownerId: z.string().optional(),
  adminUserIds: z.array(z.string()).optional(),
  memberUserIds: z.array(z.string()).optional(),
}).strict();

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { code, ...data } = patchSchema.parse(body);

    const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
    if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

    // If transferring ownership, verify the target user exists
    if (data.ownerId) {
      const targetUser = await prisma.user.findUnique({ where: { id: data.ownerId } });
      if (!targetUser) {
        return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
      }
    }

    const updated = await prisma.nation.update({
      where: { code: code.toUpperCase() },
      data,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { agents: true } },
      },
    });

    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ── Delete ───────────────────────────────────────────────

const deleteSchema = z.object({
  code: z.string().min(1),
}).strict();

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json();
    const { code } = deleteSchema.parse(body);

    const nation = await prisma.nation.findUnique({
      where: { code: code.toUpperCase() },
      include: { _count: { select: { agents: true } } },
    });
    if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

    if (nation._count.agents > 0) {
      return NextResponse.json(
        { error: `Cannot delete nation with ${nation._count.agents} agent(s). Deactivate it instead, or remove agents first.` },
        { status: 409 },
      );
    }

    // Also delete any delegations for this nation
    await prisma.$transaction([
      prisma.nationDelegation.deleteMany({ where: { nationCode: code.toUpperCase() } }),
      prisma.nation.delete({ where: { code: code.toUpperCase() } }),
    ]);

    return NextResponse.json({ deleted: code.toUpperCase() });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
