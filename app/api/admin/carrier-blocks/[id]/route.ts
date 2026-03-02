/**
 * PATCH  /api/admin/carrier-blocks/:id — Update a carrier block
 * DELETE /api/admin/carrier-blocks/:id — Deactivate a carrier block
 *
 * Admin-only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';
import { z } from 'zod';

const patchSchema = z.object({
  reason: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;
  const body = patchSchema.parse(await req.json());

  const block = await prisma.carrierBlock.update({
    where: { id },
    data: body,
  });
  return NextResponse.json(block);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { id } = await params;

  const block = await prisma.carrierBlock.update({
    where: { id },
    data: { isActive: false },
  });
  return NextResponse.json(block);
}
