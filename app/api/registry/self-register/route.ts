/**
 * POST /api/registry/self-register — Carrier self-registers + binds all nations and numbers
 *
 * Admin-only. Called on startup or manually. Registers this carrier instance
 * with the registry and binds all active nations and agent numbers.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { selfRegister } from '@/lib/services/registry';

export async function POST() {
  const admin = await requireAdmin();
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  try {
    const result = await selfRegister();
    return NextResponse.json({
      ok: true,
      carrier: result.carrier.domain,
      nationsRegistered: result.nationsRegistered,
      numbersRegistered: result.numbersRegistered,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
