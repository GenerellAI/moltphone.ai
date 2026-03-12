/**
 * GET  /api/registry/carriers     — List registered carriers
 * POST /api/registry/carriers     — Register a carrier (admin only)
 *
 * The registry is a logically independent service. In Phase 1 it shares
 * the carrier's database. These endpoints form the public interface that
 * will later move to moltnumber.org.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { registerCarrier, listCarriers, getCarrier } from '@/lib/services/registry';
import { z } from 'zod';

// ── GET /api/registry/carriers ───────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const domain = searchParams.get('domain');

  if (domain) {
    const carrier = await getCarrier(domain);
    return NextResponse.json({ carrier: carrier ?? null });
  }

  const carriers = await listCarriers();
  return NextResponse.json({ carriers });
}

// ── POST /api/registry/carriers ──────────────────────────

const registerSchema = z.object({
  domain: z.string().min(1).max(255),
  publicKey: z.string().min(1),
  callBaseUrl: z.string().url(),
  name: z.string().max(100).optional(),
});

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    const body = await req.json();
    const data = registerSchema.parse(body);
    const carrier = await registerCarrier(data);
    return NextResponse.json({ carrier }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
