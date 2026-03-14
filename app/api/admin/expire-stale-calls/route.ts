/**
 * POST /api/admin/expire-stale-calls
 *
 * Cron job to resolve stale calls:
 * - `submitted` (Ringing) tasks older than 1 hour → canceled (Missed)
 * - `working` (In Progress) tasks with no activity for 30 min → completed (Ended)
 * - `input_required` (Awaiting Reply) tasks with no activity for 30 min → completed (Ended)
 *
 * This prevents the call list from showing permanently stuck "Ringing" and
 * "In Progress" entries.
 *
 * Auth: CRON_SECRET bearer token or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { TaskStatus } from '@prisma/client';

/** Submitted (ringing) tasks older than this are considered missed */
const RINGING_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour

/** Working/input_required tasks with no activity for this long are considered ended */
const WORKING_TIMEOUT_MS = 30 * 60 * 1000; // 30 min

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

  const now = new Date();

  // Cancel stale ringing tasks (submitted > 1 hour)
  const ringingCutoff = new Date(now.getTime() - RINGING_TIMEOUT_MS);
  const canceledRinging = await prisma.task.updateMany({
    where: {
      status: TaskStatus.submitted,
      createdAt: { lt: ringingCutoff },
    },
    data: { status: TaskStatus.canceled },
  });

  // Complete stale in-progress tasks (working/input_required > 30 min with no activity)
  const workingCutoff = new Date(now.getTime() - WORKING_TIMEOUT_MS);
  const completedWorking = await prisma.task.updateMany({
    where: {
      status: { in: [TaskStatus.working, TaskStatus.input_required] },
      updatedAt: { lt: workingCutoff },
    },
    data: { status: TaskStatus.completed },
  });

  return NextResponse.json({
    ringingExpired: canceledRinging.count,
    workingExpired: completedWorking.count,
    ringingCutoff: ringingCutoff.toISOString(),
    workingCutoff: workingCutoff.toISOString(),
  });
}
