/**
 * GET   /api/admin/nations        — List all nations with full details
 * PATCH /api/admin/nations        — Admin-level nation update (ownership transfer, etc.)
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
