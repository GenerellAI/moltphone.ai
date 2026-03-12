/**
 * POST /api/admin/expire-proposals
 *
 * Cron job to expire stale direct connection proposals.
 * Auth: CRON_SECRET bearer token or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { expireStaleProposals } from '@/lib/services/direct-connections';

export async function POST(req: NextRequest) {
  // Auth: CRON_SECRET or admin session
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // OK — cron auth
  } else {
    const auth = await requireAdmin();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status! });
  }

  const count = await expireStaleProposals();
  return NextResponse.json({ expired: count });
}
