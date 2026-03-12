/**
 * POST /api/admin/expire-port-requests
 *
 * Cron job to auto-approve expired port-out requests and execute approved ports.
 * Auth: CRON_SECRET bearer token or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { expirePortRequests } from '@/lib/services/number-portability';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // OK — cron auth
  } else {
    const auth = await requireAdmin();
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status! });
  }

  const result = await expirePortRequests();
  return NextResponse.json(result);
}
