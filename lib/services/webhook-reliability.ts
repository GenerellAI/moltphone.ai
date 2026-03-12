/**
 * Webhook reliability — circuit breaker + health tracking for agent endpoints.
 *
 * Circuit breaker states (per agent):
 *   CLOSED   — webhookFailures < threshold, deliver normally
 *   OPEN     — webhookFailures ≥ threshold, skip delivery, queue task
 *   HALF-OPEN — circuitOpenUntil has passed, try one probe request
 *
 * After each delivery attempt, call recordSuccess() or recordFailure().
 */

import { prisma } from '@/lib/prisma';

const FAILURE_THRESHOLD = 5;
const CIRCUIT_OPEN_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DEGRADED_THRESHOLD = 3; // mark as degraded after 3 consecutive failures

export type CircuitState = 'closed' | 'open' | 'half-open';

export function getCircuitState(agent: {
  webhookFailures: number;
  circuitOpenUntil: Date | null;
}): CircuitState {
  if (agent.webhookFailures < FAILURE_THRESHOLD) return 'closed';
  if (agent.circuitOpenUntil && agent.circuitOpenUntil > new Date()) return 'open';
  return 'half-open'; // open period expired, allow a probe
}

/**
 * Record a successful webhook delivery. Resets failure count and degraded flag.
 */
export async function recordSuccess(agentId: string): Promise<void> {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      webhookFailures: 0,
      isDegraded: false,
      circuitOpenUntil: null,
    },
  });
}

/**
 * Record a failed webhook delivery. Increments failure count, may open circuit.
 */
export async function recordFailure(agentId: string): Promise<void> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { webhookFailures: true },
  });
  if (!agent) return;

  const newFailures = agent.webhookFailures + 1;
  const isDegraded = newFailures >= DEGRADED_THRESHOLD;
  const circuitOpen = newFailures >= FAILURE_THRESHOLD;

  await prisma.agent.update({
    where: { id: agentId },
    data: {
      webhookFailures: newFailures,
      isDegraded,
      ...(circuitOpen
        ? { circuitOpenUntil: new Date(Date.now() + CIRCUIT_OPEN_DURATION_MS) }
        : {}),
    },
  });
}

/**
 * Retry backoff schedule.
 * Returns the delay in ms for the given retry attempt (0-indexed).
 */
export function retryDelayMs(attempt: number): number {
  const delays = [1000, 5000, 30_000, 5 * 60_000, 15 * 60_000];
  return delays[Math.min(attempt, delays.length - 1)];
}

/**
 * Schedule a retry for a task. Sets nextRetryAt based on the current retryCount.
 */
export async function scheduleRetry(taskId: string): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { retryCount: true, maxRetries: true },
  });
  if (!task) return false;

  if (task.retryCount >= task.maxRetries) {
    // Exhausted retries → dead letter
    await prisma.task.update({
      where: { id: taskId },
      data: { status: 'failed', lastError: 'retries_exhausted' },
    });
    return false;
  }

  const delay = retryDelayMs(task.retryCount);
  await prisma.task.update({
    where: { id: taskId },
    data: {
      retryCount: { increment: 1 },
      nextRetryAt: new Date(Date.now() + delay),
    },
  });
  return true;
}
