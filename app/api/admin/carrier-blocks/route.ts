/**
 * GET  /api/admin/carrier-blocks — List active carrier blocks
 * POST /api/admin/carrier-blocks — Create a carrier block
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

  const blocks = await prisma.carrierBlock.findMany({
    where: { isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(blocks);
}

const createSchema = z.object({
  type: z.enum(['agent_id', 'molt_number_pattern', 'nation_code', 'ip_address']),
  value: z.string().min(1).max(500),
  reason: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = createSchema.parse(await req.json());

  const block = await prisma.carrierBlock.upsert({
    where: { type_value: { type: body.type, value: body.value } },
    update: { isActive: true, reason: body.reason, createdBy: auth.userId! },
    create: { ...body, createdBy: auth.userId! },
  });

  return NextResponse.json(block, { status: 201 });
}
