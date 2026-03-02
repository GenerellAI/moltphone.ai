/**
 * MoltPhone Credits — internal platform currency.
 *
 * Simple database-tracked credits. No blockchain, no external settlement.
 * Credits are consumed when sending tasks through the carrier.
 *
 * All mutations go through this service to maintain ledger integrity.
 */

import { prisma } from '@/lib/prisma';
import { CreditTransactionType } from '@prisma/client';

/** Credits granted to new users on signup. Generous in early access. */
export const SIGNUP_CREDITS = 10_000;

/** Minimum cost per message (base fee). */
export const BASE_MESSAGE_COST = 1;

/** Size of the "free" tier per message (bytes). Messages up to this size cost BASE_MESSAGE_COST. */
export const FREE_TIER_BYTES = 4 * 1024; // 4 KB

/** Additional credit per chunk of data above the free tier. */
export const COST_PER_CHUNK = 1;

/** Chunk size for cost calculation (bytes). */
export const CHUNK_SIZE_BYTES = 4 * 1024; // 4 KB

/**
 * Calculate the credit cost for a message based on its serialized size.
 *
 * Pricing: BASE_MESSAGE_COST + ceil(max(0, size - FREE_TIER_BYTES) / CHUNK_SIZE_BYTES) * COST_PER_CHUNK
 *
 * Examples:
 *   100 bytes → 1 credit  (short text)
 *   4 KB      → 1 credit  (within free tier)
 *   8 KB      → 2 credits (1 base + 1 chunk)
 *   20 KB     → 5 credits (1 base + 4 chunks)
 *   100 KB    → 25 credits (1 base + 24 chunks)
 */
export function calculateMessageCost(rawBody: string | Buffer): number {
  const sizeBytes = typeof rawBody === 'string'
    ? Buffer.byteLength(rawBody, 'utf-8')
    : rawBody.length;

  if (sizeBytes <= FREE_TIER_BYTES) return BASE_MESSAGE_COST;

  const extraBytes = sizeBytes - FREE_TIER_BYTES;
  const extraChunks = Math.ceil(extraBytes / CHUNK_SIZE_BYTES);
  return BASE_MESSAGE_COST + extraChunks * COST_PER_CHUNK;
}

// ── Query ────────────────────────────────────────────────

export async function getBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { credits: true },
  });
  return user?.credits ?? 0;
}

export async function getTransactionHistory(
  userId: string,
  opts: { cursor?: string; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 100);
  return prisma.creditTransaction.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
  });
}

// ── Mutations ────────────────────────────────────────────

/**
 * Grant signup credits to a new user. Idempotent — skips if user already
 * has a signup_grant transaction.
 */
export async function grantSignupCredits(userId: string): Promise<number> {
  // Idempotency: check if signup grant already exists
  const existing = await prisma.creditTransaction.findFirst({
    where: { userId, type: CreditTransactionType.signup_grant },
  });
  if (existing) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return user?.credits ?? 0;
  }

  const [, user] = await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        amount: SIGNUP_CREDITS,
        type: CreditTransactionType.signup_grant,
        balance: SIGNUP_CREDITS,
        description: `Welcome bonus: ${SIGNUP_CREDITS} credits`,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: SIGNUP_CREDITS } },
      select: { credits: true },
    }),
  ]);

  return user.credits;
}

/**
 * Admin grant: add credits to a user account.
 */
export async function adminGrantCredits(
  userId: string,
  amount: number,
  description?: string,
): Promise<number> {
  if (amount <= 0) throw new Error('Amount must be positive');

  const [, user] = await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        amount,
        type: CreditTransactionType.admin_grant,
        balance: 0, // will be updated below
        description: description ?? `Admin grant: ${amount} credits`,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
      select: { credits: true },
    }),
  ]);

  // Update the transaction with the correct balance
  const lastTx = await prisma.creditTransaction.findFirst({
    where: { userId, type: CreditTransactionType.admin_grant },
    orderBy: { createdAt: 'desc' },
  });
  if (lastTx) {
    await prisma.creditTransaction.update({
      where: { id: lastTx.id },
      data: { balance: user.credits },
    });
  }

  return user.credits;
}

/**
 * Deduct credits for sending a task. Cost is based on message size.
 * Returns { ok, balance, cost } or { ok: false, balance, cost }.
 * Uses a transaction to prevent race conditions.
 */
export async function deductTaskCredits(
  userId: string,
  cost: number,
  taskId?: string,
): Promise<{ ok: true; balance: number; cost: number } | { ok: false; balance: number; cost: number }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      return { ok: false as const, balance: user?.credits ?? 0, cost };
    }

    const newBalance = user.credits - cost;

    await tx.user.update({
      where: { id: userId },
      data: { credits: newBalance },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -cost,
        type: CreditTransactionType.task_send,
        balance: newBalance,
        description: cost === 1 ? 'Task sent' : `Task sent (${cost} credits, size-based)`,
        taskId,
      },
    });

    return { ok: true as const, balance: newBalance, cost };
  });
}

/**
 * Deduct credits for a message in an existing task (reply / follow-up).
 * Cost is based on message size. Charges the sender's owner.
 * Returns { ok, balance, cost } or { ok: false, balance, cost }.
 */
export async function deductMessageCredits(
  userId: string,
  cost: number,
  taskId: string,
  description = 'Message sent',
): Promise<{ ok: true; balance: number; cost: number } | { ok: false; balance: number; cost: number }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < cost) {
      return { ok: false as const, balance: user?.credits ?? 0, cost };
    }

    const newBalance = user.credits - cost;

    await tx.user.update({
      where: { id: userId },
      data: { credits: newBalance },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -cost,
        type: CreditTransactionType.task_message,
        balance: newBalance,
        description: cost === 1 ? description : `${description} (${cost} credits, size-based)`,
        taskId,
      },
    });

    return { ok: true as const, balance: newBalance, cost };
  });
}

/**
 * Refund credits for a failed task delivery (e.g. retries exhausted).
 * Amount defaults to BASE_MESSAGE_COST but can be set to the original charge.
 */
export async function refundTaskCredits(
  userId: string,
  taskId: string,
  amount = BASE_MESSAGE_COST,
  reason?: string,
): Promise<number> {
  const [, user] = await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        amount,
        type: CreditTransactionType.refund,
        balance: 0, // updated below
        description: reason ?? 'Refund: delivery failed',
        taskId,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: amount } },
      select: { credits: true },
    }),
  ]);

  const lastTx = await prisma.creditTransaction.findFirst({
    where: { userId, type: CreditTransactionType.refund, taskId },
    orderBy: { createdAt: 'desc' },
  });
  if (lastTx) {
    await prisma.creditTransaction.update({
      where: { id: lastTx.id },
      data: { balance: user.credits },
    });
  }

  return user.credits;
}
