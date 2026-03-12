/**
 * POST /api/admin/expire-unclaimed
 *
 * Cron job to deactivate unclaimed agents past their claim expiry.
 * Auth: CRON_SECRET bearer token or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/prisma';

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

  // Deactivate unclaimed agents whose claim window has passed
  const result = await prisma.agent.updateMany({
    where: {
      ownerId: { equals: null },
      isActive: true,
      claimExpiresAt: { lt: new Date() },
    },
    data: { isActive: false },
  });

  return NextResponse.json({ expired: result.count });
}
