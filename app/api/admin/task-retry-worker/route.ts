/**
 * POST /api/admin/task-retry-worker
 *
 * Cron-callable endpoint that processes tasks eligible for retry.
 * Queries tasks with status=submitted and nextRetryAt <= now.
 * For each: attempts webhook delivery, handles success/failure, schedules next retry.
 *
 * Secured by admin auth OR a shared CRON_SECRET.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { validateWebhookUrl } from '@/lib/ssrf';
import { getCircuitState, recordSuccess, recordFailure, scheduleRetry } from '@/lib/services/webhook-reliability';
import { TaskStatus, Prisma } from '@prisma/client';

const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS || '5000', 10);
const BATCH_SIZE = parseInt(process.env.RETRY_BATCH_SIZE || '20', 10);

function asParts(parts: unknown): Prisma.InputJsonValue {
  return parts as Prisma.InputJsonValue;
}

export async function POST(req: NextRequest) {
  // Auth: admin session or CRON_SECRET header
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    // OK — cron auth
  } else {
    // Fall back to admin session check
    const { requireAdmin } = await import('@/lib/admin');
    const adminCheck = await requireAdmin();
    if (adminCheck) return adminCheck; // returns error response
  }

  const now = new Date();

  // Fetch tasks due for retry
  const tasks = await prisma.task.findMany({
    where: {
      status: TaskStatus.submitted,
      nextRetryAt: { lte: now },
    },
    include: {
      callee: true,
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 1, // original message
      },
    },
    take: BATCH_SIZE,
    orderBy: { nextRetryAt: 'asc' },
  });

  const results: { taskId: string; result: string }[] = [];

  for (const task of tasks) {
    const agent = task.callee;

    // If agent has no endpoint or is inactive, mark as failed
    if (!agent.endpointUrl || !agent.isActive) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.failed, lastError: 'no_endpoint' },
      });
      results.push({ taskId: task.id, result: 'failed:no_endpoint' });
      continue;
    }

    // Circuit breaker check
    const circuit = getCircuitState(agent);
    if (circuit === 'open') {
      // Re-schedule for after circuit opens
      await prisma.task.update({
        where: { id: task.id },
        data: { nextRetryAt: agent.circuitOpenUntil ?? new Date(Date.now() + 60_000) },
      });
      results.push({ taskId: task.id, result: 'deferred:circuit_open' });
      continue;
    }

    // SSRF validation
    const ssrfCheck = await validateWebhookUrl(agent.endpointUrl);
    if (!ssrfCheck.ok) {
      await prisma.task.update({
        where: { id: task.id },
        data: { status: TaskStatus.failed, lastError: 'ssrf_blocked' },
      });
      results.push({ taskId: task.id, result: 'failed:ssrf_blocked' });
      continue;
    }

    // Attempt delivery
    const originalMessage = task.messages[0];
    const body = JSON.stringify({
      id: task.taskId,
      sessionId: task.sessionId,
      message: {
        role: originalMessage?.role ?? 'user',
        parts: originalMessage?.parts ?? [],
      },
      metadata: {
        'molt.intent': task.intent,
        'molt.retry': task.retryCount,
      },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);
    let success = false;

    try {
      const response = await fetch(agent.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-MoltPhone-Target': agent.id,
          'X-MoltPhone-Retry': String(task.retryCount),
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        success = true;
        await recordSuccess(agent.id);

        const responseBody = await response.text();
        let responseParts: unknown[];
        try {
          const parsed = JSON.parse(responseBody);
          responseParts = Array.isArray(parsed?.message?.parts)
            ? parsed.message.parts
            : [{ type: 'text', text: responseBody }];
        } catch {
          responseParts = [{ type: 'text', text: responseBody }];
        }

        await prisma.$transaction([
          prisma.task.update({
            where: { id: task.id },
            data: {
              status: task.intent === 'text' ? TaskStatus.completed : TaskStatus.working,
              nextRetryAt: null,
              lastError: null,
            },
          }),
          prisma.taskMessage.create({
            data: {
              taskId: task.id,
              role: 'agent',
              parts: asParts(responseParts),
            },
          }),
          prisma.taskEvent.create({
            data: {
              taskId: task.id,
              type: 'task.retry_success',
              payload: { retryCount: task.retryCount } as unknown as Prisma.InputJsonValue,
              sequenceNumber: task.retryCount + 2,
            },
          }),
        ]);
        results.push({ taskId: task.id, result: 'success' });
      }
    } catch {
      clearTimeout(timeout);
    }

    if (!success) {
      await recordFailure(agent.id);
      const scheduled = await scheduleRetry(task.id);
      await prisma.task.update({
        where: { id: task.id },
        data: { lastError: 'delivery_failed' },
      });
      results.push({
        taskId: task.id,
        result: scheduled ? `retry_scheduled:attempt_${task.retryCount + 1}` : 'failed:retries_exhausted',
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
