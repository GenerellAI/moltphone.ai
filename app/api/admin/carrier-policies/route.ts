/**
 * GET  /api/admin/carrier-policies — List active carrier policies
 * POST /api/admin/carrier-policies — Create/update a carrier policy
 * DELETE /api/admin/carrier-policies — Deactivate a carrier policy by type
 *
 * Admin-only. Each policy type can only have one active instance.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { z } from 'zod';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const policies = await prisma.carrierPolicy.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(policies);
}

const createSchema = z.object({
  type: z.enum(['require_verified_domain', 'require_social_verification', 'minimum_age_hours']),
  value: z.string().max(100).optional().default(''),
  reason: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = createSchema.parse(await req.json());

  const policy = await prisma.carrierPolicy.upsert({
    where: { type: body.type },
    update: { value: body.value, reason: body.reason, isActive: true, createdBy: auth.userId! },
    create: { type: body.type, value: body.value, reason: body.reason, createdBy: auth.userId! },
  });

  return NextResponse.json(policy, { status: 201 });
}

const deleteSchema = z.object({
  type: z.enum(['require_verified_domain', 'require_social_verification', 'minimum_age_hours']),
});

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = deleteSchema.parse(await req.json());

  await prisma.carrierPolicy.updateMany({
    where: { type: body.type },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
