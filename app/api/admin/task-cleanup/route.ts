/**
 * POST /api/admin/task-cleanup
 *
 * Cron job to delete completed/canceled/failed tasks older than the retention
 * window (TASK_RETENTION_DAYS, default 30 days). Also deletes associated
 * TaskMessage and TaskEvent records.
 *
 * Auth: CRON_SECRET bearer token or admin session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/prisma';
import { TASK_RETENTION_DAYS } from '@/carrier.config';
import { TaskStatus } from '@prisma/client';

/** Maximum tasks to delete per invocation to avoid long-running transactions. */
const BATCH_SIZE = 1000;

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

  const cutoff = new Date(Date.now() - TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Find old terminal tasks (completed, canceled, failed)
  const oldTasks = await prisma.task.findMany({
    where: {
      createdAt: { lt: cutoff },
      status: { in: [TaskStatus.completed, TaskStatus.canceled, TaskStatus.failed] },
    },
    select: { id: true },
    take: BATCH_SIZE,
  });

  if (oldTasks.length === 0) {
    return NextResponse.json({ deleted: 0, messages: 0, events: 0 });
  }

  const ids = oldTasks.map(t => t.id);

  // Delete child records first (FK constraints), then tasks
  const [events, messages, tasks] = await prisma.$transaction([
    prisma.taskEvent.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.taskMessage.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.task.deleteMany({ where: { id: { in: ids } } }),
  ]);

  return NextResponse.json({
    deleted: tasks.count,
    messages: messages.count,
    events: events.count,
    retentionDays: TASK_RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
  });
}
