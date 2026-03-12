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
import { CREDITS_ENABLED } from '@/carrier.config';

/** Credits granted to new users on signup. Generous in early access. */
export const SIGNUP_CREDITS = 10_000;

// ── Sybil Resistance ────────────────────────────────────

/** Maximum agents a single user can create (excluding personal agent). */
export const MAX_AGENTS_PER_USER = 10;

/** Credit cost to register a new agent. Makes mass registration expensive. */
export const AGENT_CREATION_COST = 100;

/** Minimum seconds between agent creation for the same user. */
export const AGENT_CREATION_COOLDOWN_S = parseInt(process.env.AGENT_CREATION_COOLDOWN_S || '60', 10);

// ── Nation Sybil Resistance ─────────────────────────────

/** Maximum nations a single user can create. */
export const MAX_NATIONS_PER_USER = parseInt(process.env.MAX_NATIONS_PER_USER || '3', 10);

/** Credit cost to register a new nation. Higher than agents — nations are scarce. */
export const NATION_CREATION_COST = 500;

/** Minimum seconds between nation creation for the same user (24 hours). */
export const NATION_CREATION_COOLDOWN_S = parseInt(process.env.NATION_CREATION_COOLDOWN_S || '86400', 10);

/** Number of days a nation has to reach the minimum agent threshold. */
export const NATION_PROVISIONAL_DAYS = 30;

/** Minimum agents needed to graduate from provisional status. */
export const NATION_MIN_AGENTS_TO_GRADUATE = 10;

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
 *
 * Uses atomic `decrement` with a `WHERE credits >= cost` guard to prevent
 * race conditions under concurrent load (two requests reading the same
 * balance and both deducting).
 */
export async function deductTaskCredits(
  userId: string,
  cost: number,
  taskId?: string,
): Promise<{ ok: true; balance: number; cost: number } | { ok: false; balance: number; cost: number }> {
  if (!CREDITS_ENABLED) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return { ok: true, balance: user?.credits ?? 0, cost };
  }
  return prisma.$transaction(async (tx) => {
    // Atomic decrement with guard — prevents negative balance under concurrency
    const result = await tx.user.updateMany({
      where: { id: userId, credits: { gte: cost } },
      data: { credits: { decrement: cost } },
    });

    if (result.count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return { ok: false as const, balance: user?.credits ?? 0, cost };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    const newBalance = user?.credits ?? 0;

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
  if (!CREDITS_ENABLED) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return { ok: true, balance: user?.credits ?? 0, cost };
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId, credits: { gte: cost } },
      data: { credits: { decrement: cost } },
    });

    if (result.count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return { ok: false as const, balance: user?.credits ?? 0, cost };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    const newBalance = user?.credits ?? 0;

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
 * Charge credits for carrier_only relay traffic (TURN-style persistent allocation).
 *
 * When an agent's directConnectionPolicy is `carrier_only`, ALL traffic is relayed
 * through the carrier — like a TURN Allocation (RFC 8656). The agent's *owner* pays
 * for this relay service, size-based per message.
 *
 * This is the only path in the system that charges credits for messaging.
 * Basic messaging (non-carrier_only) is free to maximize network effects.
 */
export async function deductRelayCredits(
  userId: string,
  cost: number,
  taskId: string,
  direction: 'inbound' | 'outbound' = 'inbound',
): Promise<{ ok: true; balance: number; cost: number } | { ok: false; balance: number; cost: number }> {
  if (!CREDITS_ENABLED) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return { ok: true, balance: user?.credits ?? 0, cost };
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId, credits: { gte: cost } },
      data: { credits: { decrement: cost } },
    });

    if (result.count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return { ok: false as const, balance: user?.credits ?? 0, cost };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    const newBalance = user?.credits ?? 0;

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -cost,
        type: CreditTransactionType.relay_charge,
        balance: newBalance,
        description: cost === 1
          ? `Privacy relay (${direction})`
          : `Privacy relay (${direction}, ${cost} credits, size-based)`,
        taskId,
      },
    });

    return { ok: true as const, balance: newBalance, cost };
  });
}

// ── Sybil Guard: Agent Creation ──────────────────────────

/**
 * Check whether a user is allowed to create a new agent.
 * Enforces per-user quota and minimum cooldown interval.
 */
export async function canCreateAgent(userId: string): Promise<
  | { ok: true }
  | { ok: false; reason: string }
> {
  // 1. Check per-user agent quota (excludes personal agent)
  const agentCount = await prisma.agent.count({
    where: { ownerId: userId, isActive: true },
  });
  // User gets 1 personal agent at signup (free). Count everything.
  if (agentCount >= MAX_AGENTS_PER_USER + 1) {  // +1 for personal agent
    return {
      ok: false,
      reason: `Agent limit reached (${MAX_AGENTS_PER_USER} agents). Delete an existing agent or contact support.`,
    };
  }

  // 2. Cooldown — check last agent creation timestamp (active agents only)
  const lastAgent = await prisma.agent.findFirst({
    where: { ownerId: userId, isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (lastAgent) {
    const elapsed = (Date.now() - lastAgent.createdAt.getTime()) / 1000;
    if (elapsed < AGENT_CREATION_COOLDOWN_S) {
      const wait = Math.ceil(AGENT_CREATION_COOLDOWN_S - elapsed);
      return {
        ok: false,
        reason: `Please wait ${wait}s before creating another agent.`,
      };
    }
  }

  // 3. Check credit balance (pre-flight — actual deduction happens via deductAgentCreationCredits)
  if (CREDITS_ENABLED) {
    const balance = await getBalance(userId);
    if (balance < AGENT_CREATION_COST) {
      return {
        ok: false,
        reason: `Insufficient credits. Agent creation costs ${AGENT_CREATION_COST} credits (balance: ${balance}).`,
      };
    }
  }

  return { ok: true };
}

/**
 * Deduct credits for creating a new agent.
 * Returns remaining balance or error.
 */
export async function deductAgentCreationCredits(
  userId: string,
  agentMoltNumber: string,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  if (!CREDITS_ENABLED) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return { ok: true, balance: user?.credits ?? 0 };
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId, credits: { gte: AGENT_CREATION_COST } },
      data: { credits: { decrement: AGENT_CREATION_COST } },
    });

    if (result.count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return { ok: false as const, balance: user?.credits ?? 0 };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    const newBalance = user?.credits ?? 0;

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -AGENT_CREATION_COST,
        type: CreditTransactionType.agent_creation,
        balance: newBalance,
        description: `Agent registered: ${agentMoltNumber} (${AGENT_CREATION_COST} credits)`,
      },
    });

    return { ok: true as const, balance: newBalance };
  });
}

// ── Nation Creation Guards ───────────────────────────────

/** Reserved nation codes that cannot be user-created. */
export const RESERVED_NATION_CODES = ['MOLT', 'TEST', 'XXXX', 'NULL', 'VOID'];

/**
 * Check whether a user is allowed to create a new nation.
 * Enforces: verified email, per-user quota, 24h cooldown, credit balance.
 */
export async function canCreateNation(userId: string): Promise<
  | { ok: true }
  | { ok: false; reason: string }
> {
  // 0. Check verified email
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailVerifiedAt: true, credits: true },
  });
  if (!user) return { ok: false, reason: 'User not found' };
  if (!user.emailVerifiedAt) {
    return { ok: false, reason: 'You must verify your email before creating a nation.' };
  }

  // 1. Per-user nation quota
  const nationCount = await prisma.nation.count({
    where: { ownerId: userId, isActive: true },
  });
  if (nationCount >= MAX_NATIONS_PER_USER) {
    return {
      ok: false,
      reason: `Nation limit reached (${MAX_NATIONS_PER_USER} nations). A nation must be deactivated before creating another.`,
    };
  }

  // 2. Cooldown — check last nation creation timestamp
  const lastNation = await prisma.nation.findFirst({
    where: { ownerId: userId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  if (lastNation) {
    const elapsed = (Date.now() - lastNation.createdAt.getTime()) / 1000;
    if (elapsed < NATION_CREATION_COOLDOWN_S) {
      const wait = Math.ceil(NATION_CREATION_COOLDOWN_S - elapsed);
      const hours = Math.ceil(wait / 3600);
      return {
        ok: false,
        reason: `Please wait ${hours > 1 ? `~${hours}h` : `${wait}s`} before creating another nation.`,
      };
    }
  }

  // 3. Check credit balance (pre-flight)
  if (CREDITS_ENABLED && user.credits < NATION_CREATION_COST) {
    return {
      ok: false,
      reason: `Insufficient credits. Nation creation costs ${NATION_CREATION_COST} credits (balance: ${user.credits}).`,
    };
  }

  return { ok: true };
}

/**
 * Deduct credits for creating a new nation.
 * Returns remaining balance or error.
 */
export async function deductNationCreationCredits(
  userId: string,
  nationCode: string,
): Promise<{ ok: true; balance: number } | { ok: false; balance: number }> {
  if (!CREDITS_ENABLED) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { credits: true } });
    return { ok: true, balance: user?.credits ?? 0 };
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.user.updateMany({
      where: { id: userId, credits: { gte: NATION_CREATION_COST } },
      data: { credits: { decrement: NATION_CREATION_COST } },
    });

    if (result.count === 0) {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
      return { ok: false as const, balance: user?.credits ?? 0 };
    }

    const user = await tx.user.findUnique({ where: { id: userId }, select: { credits: true } });
    const newBalance = user?.credits ?? 0;

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -NATION_CREATION_COST,
        type: CreditTransactionType.nation_creation,
        balance: newBalance,
        description: `Nation registered: ${nationCode} (${NATION_CREATION_COST} credits)`,
      },
    });

    return { ok: true as const, balance: newBalance };
  });
}

/**
 * Check if a nation should graduate from provisional status.
 * Called after agent creation. If the nation has >= NATION_MIN_AGENTS_TO_GRADUATE
 * active agents and is still provisional, clears provisionalUntil.
 */
export async function checkNationGraduation(nationCode: string): Promise<boolean> {
  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { provisionalUntil: true, _count: { select: { agents: { where: { isActive: true } } } } },
  });

  if (!nation || !nation.provisionalUntil) return false; // already graduated or not found

  if (nation._count.agents >= NATION_MIN_AGENTS_TO_GRADUATE) {
    await prisma.nation.update({
      where: { code: nationCode },
      data: { provisionalUntil: null },
    });
    return true; // graduated!
  }

  return false;
}

// ── Refund ────────────────────────────────────────────────

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
