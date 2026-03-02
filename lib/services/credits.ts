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

/** Cost to create a new task (initial message). */
export const TASK_COST = 1;

/** Cost per message in a multi-turn conversation (replies, follow-ups). */
export const MESSAGE_COST = 1;

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
 * Deduct credits for sending a task. Returns { ok, balance } or { ok: false, balance }.
 * Uses a transaction to prevent race conditions.
 */
export async function deductTaskCredits(
  userId: string,
  taskId?: string,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < TASK_COST) {
      return { ok: false as const, balance: user?.credits ?? 0 };
    }

    const newBalance = user.credits - TASK_COST;

    await tx.user.update({
      where: { id: userId },
      data: { credits: newBalance },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -TASK_COST,
        type: CreditTransactionType.task_send,
        balance: newBalance,
        description: 'Task sent',
        taskId,
      },
    });

    return { ok: true as const, balance: newBalance };
  });
}

/**
 * Deduct credits for a message in an existing task (reply / follow-up).
 * Charges the sender's owner. Returns { ok, balance } or { ok: false, balance }.
 */
export async function deductMessageCredits(
  userId: string,
  taskId: string,
  description = 'Message sent',
): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { credits: true },
    });

    if (!user || user.credits < MESSAGE_COST) {
      return { ok: false as const, balance: user?.credits ?? 0 };
    }

    const newBalance = user.credits - MESSAGE_COST;

    await tx.user.update({
      where: { id: userId },
      data: { credits: newBalance },
    });

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -MESSAGE_COST,
        type: CreditTransactionType.task_message,
        balance: newBalance,
        description,
        taskId,
      },
    });

    return { ok: true as const, balance: newBalance };
  });
}

/**
 * Refund credits for a failed task delivery (e.g. retries exhausted).
 */
export async function refundTaskCredits(
  userId: string,
  taskId: string,
  reason?: string,
): Promise<number> {
  const [, user] = await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        userId,
        amount: TASK_COST,
        type: CreditTransactionType.refund,
        balance: 0, // updated below
        description: reason ?? 'Refund: delivery failed',
        taskId,
      },
    }),
    prisma.user.update({
      where: { id: userId },
      data: { credits: { increment: TASK_COST } },
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
