/**
 * Nonce deduplication — replay protection for Ed25519-authenticated requests.
 *
 * Two functions:
 *   - `checkNonce(key)` — returns true if the nonce was already used (replay)
 *   - `recordNonce(key)` — records a nonce as used (with auto-expiry)
 *
 * Backends:
 *   - **Redis** (primary) — `SET key NX EX 600` via Upstash (@upstash/redis over
 *     HTTP) — atomic check + insert in one command. Auto-expires via TTL.
 *   - **PostgreSQL** (fallback) — `prisma.nonceUsed.findUnique` + `create`.
 *     Used when Redis is unavailable or Upstash env vars are not set.
 *
 * The 10-minute TTL matches the ±300s timestamp window (5 min × 2 = 10 min).
 *
 * Circuit breaker: shares the same Redis client as the rate limiter. If Redis
 * errors, falls back to PostgreSQL transparently.
 */

import { getRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';
import { prisma } from '@/lib/prisma';

/** Nonce TTL: 10 minutes (matches ±300s timestamp window × 2). */
const NONCE_TTL_SECONDS = 600;

// ── Redis client (lazy, shared) ──────────────────────────

let _redisChecked = false;
let _redis: Redis | null = null;

function redis(): Redis | null {
  if (!_redisChecked) {
    _redis = getRedis();
    _redisChecked = true;
  }
  return _redis;
}

// ── Public API ───────────────────────────────────────────

/**
 * Check if a nonce has been used before AND record it atomically.
 *
 * Returns `true` if this is a **replay** (nonce was already used).
 * Returns `false` if the nonce is fresh (and it's now recorded).
 *
 * This combines check + record into one call because the Redis path
 * (`SET NX`) is inherently atomic — separating them would lose that benefit.
 *
 * @param nonceKey  Composite key, typically `${callerMoltNumber}:${nonce}`
 */
export async function isNonceReplay(nonceKey: string): Promise<boolean> {
  const r = redis();
  if (r) {
    try {
      // SET key 1 NX EX 600 — returns "OK" if set (fresh), null if exists (replay)
      const result = await r.set(`nonce:${nonceKey}`, '1', { nx: true, ex: NONCE_TTL_SECONDS });
      return result === null; // null = key already existed = replay
    } catch (err) {
      console.warn('[nonce] Redis error, falling back to PostgreSQL:', (err as Error).message);
      // Fall through to PostgreSQL
    }
  }

  // PostgreSQL fallback
  return isNonceReplayPg(nonceKey);
}

/**
 * PostgreSQL-backed nonce check + record.
 * Uses findUnique (check) + create (record) — two queries, but reliable.
 */
async function isNonceReplayPg(nonceKey: string): Promise<boolean> {
  const existing = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
  if (existing) return true; // replay

  await prisma.nonceUsed.create({
    data: {
      nonce: nonceKey,
      expiresAt: new Date(Date.now() + NONCE_TTL_SECONDS * 1000),
    },
  });
  return false; // fresh
}
