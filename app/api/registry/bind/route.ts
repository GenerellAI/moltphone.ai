/**
 * POST   /api/registry/bind     — Bind a MoltNumber to a carrier
 * DELETE /api/registry/bind     — Unbind a MoltNumber
 *
 * Called by carriers when agents are created/deleted. In Phase 1 this is
 * admin-only. In the future it will use carrier Ed25519 authentication.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { bindNumber, unbindNumber } from '@/lib/services/registry';
import { z } from 'zod';

// ── POST /api/registry/bind ─────────────────────────────

const bindSchema = z.object({
  moltNumber: z.string().min(1),
  carrierDomain: z.string().min(1),
  nationCode: z.string().regex(/^[A-Z]{4}$/),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    const body = await req.json();
    const data = bindSchema.parse(body);
    const binding = await bindNumber(data);
    return NextResponse.json({ binding }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE /api/registry/bind ────────────────────────────

const unbindSchema = z.object({
  moltNumber: z.string().min(1),
});

export async function DELETE(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    const body = await req.json();
    const data = unbindSchema.parse(body);
    await unbindNumber(data.moltNumber);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
