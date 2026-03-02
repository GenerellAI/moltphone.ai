/**
 * POST /api/admin/nonce-cleanup — Prune expired nonces
 *
 * Intended to be called periodically (cron / external scheduler).
 * Protected by a shared secret (CRON_SECRET env var) or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';

export async function POST(req: NextRequest) {
  // Allow either CRON_SECRET bearer token or admin session
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // OK — cron authenticated
  } else {
    const auth = await requireAdmin();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const result = await prisma.nonceUsed.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });

  return NextResponse.json({ deleted: result.count });
}
