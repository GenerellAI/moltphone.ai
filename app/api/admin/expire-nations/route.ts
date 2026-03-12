/**
 * POST /api/admin/expire-nations
 *
 * Cron job to deactivate provisional nations that failed to reach
 * the minimum agent threshold (10 agents) within 30 days.
 *
 * Auth: CRON_SECRET bearer token or admin session.
 *
 * Deactivated nations:
 * - Cannot have new agents registered
 * - Don't appear in public listings
 * - Existing agents continue to work (they keep their numbers)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { NATION_MIN_AGENTS_TO_GRADUATE } from '@/lib/services/credits';

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

  // Find provisional nations past their deadline with fewer than the required agents
  const now = new Date();

  // Get all provisional nations that have passed their deadline
  const expiredProvisional = await prisma.nation.findMany({
    where: {
      isActive: true,
      provisionalUntil: { lt: now },
    },
    include: {
      _count: { select: { agents: { where: { isActive: true } } } },
    },
  });

  // Filter to those that haven't met the threshold
  const toDeactivate = expiredProvisional.filter(
    (n) => n._count.agents < NATION_MIN_AGENTS_TO_GRADUATE,
  );

  // Deactivate them
  let deactivatedCount = 0;
  for (const nation of toDeactivate) {
    await prisma.nation.update({
      where: { id: nation.id },
      data: { isActive: false },
    });
    deactivatedCount++;
  }

  // Also auto-graduate any nations that have met the threshold but are still provisional
  const toGraduate = expiredProvisional.filter(
    (n) => n._count.agents >= NATION_MIN_AGENTS_TO_GRADUATE,
  );
  let graduatedCount = 0;
  for (const nation of toGraduate) {
    await prisma.nation.update({
      where: { id: nation.id },
      data: { provisionalUntil: null },
    });
    graduatedCount++;
  }

  // Also check non-expired provisional nations that have enough agents (early graduation)
  const earlyGraduates = await prisma.nation.findMany({
    where: {
      isActive: true,
      provisionalUntil: { gte: now },
    },
    include: {
      _count: { select: { agents: { where: { isActive: true } } } },
    },
  });

  for (const nation of earlyGraduates) {
    if (nation._count.agents >= NATION_MIN_AGENTS_TO_GRADUATE) {
      await prisma.nation.update({
        where: { id: nation.id },
        data: { provisionalUntil: null },
      });
      graduatedCount++;
    }
  }

  return NextResponse.json({
    deactivated: deactivatedCount,
    graduated: graduatedCount,
    checked: expiredProvisional.length + earlyGraduates.length,
  });
}
