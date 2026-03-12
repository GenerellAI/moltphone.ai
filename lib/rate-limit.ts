/**
 * Token-bucket rate limiter with sliding-window fallback.
 *
 * Two layers of protection:
 *   1. **Token bucket** — controls burst rate. Tokens refill at a steady rate
 *      (e.g. 1 token/second). Bucket capacity limits the maximum burst size.
 *   2. **Sliding window** — caps total requests within a time window (e.g. 60/min).
 *
 * The limiter also supports **per-target** rate limiting to prevent one caller
 * from flooding a single agent.
 *
 * Backends:
 *   - **In-memory** (default) — `Map`-based. Good for single-process.
 *   - **Redis** — uses atomic Lua scripts via Upstash (@upstash/redis over HTTP).
 *     Enabled when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set.
 *     Suitable for horizontal scaling (multiple carrier instances).
 *
 * Usage:
 *   const result = await rateLimit(key);
 *   if (!result.ok) return moltErrorResponse(MOLT_RATE_LIMITED, result.error, undefined, null, result.headers);
 */

import { getRedis } from '@/lib/redis';
import type { Redis } from '@upstash/redis';

// ── Configuration ────────────────────────────────────────

/** Max requests per window (sustained rate). */
const DEFAULT_MAX_REQUESTS = 60;
/** Sliding window duration. */
const DEFAULT_WINDOW_MS = 60_000; // 1 minute
/** Token bucket capacity — max burst size. */
const DEFAULT_BUCKET_CAPACITY = 10;
/** Token refill rate (tokens per second). */
const DEFAULT_REFILL_RATE = 2; // 2 req/sec steady state
/** Per-caller-target limit within the window. */
const DEFAULT_PER_TARGET_LIMIT = 20;

// ── Result types ─────────────────────────────────────────

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  error?: string;
  /** Headers to include in the response (Retry-After, X-RateLimit-*). */
  headers?: Record<string, string>;
}

export interface RateLimitOptions {
  maxRequests?: number;
  windowMs?: number;
  bucketCapacity?: number;
  refillRate?: number;
}

// ── Redis Lua scripts (atomic operations) ────────────────

/**
 * Lua script: atomic token-bucket consume.
 *
 * KEYS[1] = bucket key
 * ARGV[1] = capacity
 * ARGV[2] = refillRate (tokens/sec)
 * ARGV[3] = now (ms)
 * ARGV[4] = TTL (seconds) for key expiry
 *
 * Returns: [ok (0|1), tokens_remaining, retry_after_ms]
 */
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'lastRefill')
local tokens = tonumber(data[1])
local lastRefill = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  lastRefill = now
end

-- Refill tokens
local elapsed = (now - lastRefill) / 1000
tokens = math.min(capacity, tokens + elapsed * refillRate)
lastRefill = now

if tokens < 1 then
  -- Not enough tokens
  redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
  redis.call('EXPIRE', key, ttl)
  local retryAfterMs = math.ceil((1 - tokens) / refillRate * 1000)
  return {0, 0, retryAfterMs}
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'lastRefill', lastRefill)
redis.call('EXPIRE', key, ttl)
return {1, math.floor(tokens), 0}
`;

/**
 * Lua script: atomic sliding-window check + increment.
 *
 * KEYS[1] = sorted set key
 * ARGV[1] = now (ms)
 * ARGV[2] = windowMs
 * ARGV[3] = maxRequests
 * ARGV[4] = unique member (now + random suffix to avoid dupes)
 * ARGV[5] = TTL (seconds) for key expiry
 *
 * Returns: [ok (0|1), remaining, retry_after_ms]
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local maxReqs = tonumber(ARGV[3])
local member = ARGV[4]
local ttl = tonumber(ARGV[5])

local windowStart = now - windowMs

-- Remove expired entries
redis.call('ZREMRANGEBYSCORE', key, 0, windowStart)

local count = redis.call('ZCARD', key)
if count >= maxReqs then
  -- Get oldest to calculate retry-after
  local oldest = redis.call('ZRANGEBYSCORE', key, '-inf', '+inf', 'LIMIT', 0, 1)
  local retryMs = 0
  if #oldest > 0 then
    local oldestScore = tonumber(redis.call('ZSCORE', key, oldest[1]))
    retryMs = math.max(0, oldestScore + windowMs - now)
  end
  return {0, 0, retryMs}
end

redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl)
local remaining = maxReqs - count - 1
return {1, remaining, 0}
`;

// ── In-memory stores (fallback) ──────────────────────────

interface TokenBucketEntry {
  tokens: number;
  lastRefill: number;
}

interface SlidingWindowEntry {
  timestamps: number[];
}

const memBucketStore = new Map<string, TokenBucketEntry>();
const memWindowStore = new Map<string, SlidingWindowEntry>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - DEFAULT_WINDOW_MS * 2;
  for (const [key, entry] of memWindowStore) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) memWindowStore.delete(key);
  }
  for (const [key, entry] of memBucketStore) {
    if (entry.lastRefill < cutoff) memBucketStore.delete(key);
  }
}, 5 * 60_000);

// ── In-memory token bucket ───────────────────────────────

function consumeTokenMem(
  key: string,
  capacity: number,
  refillRate: number,
): { ok: boolean; tokens: number; retryAfterMs: number } {
  const now = Date.now();
  let bucket = memBucketStore.get(key);

  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    memBucketStore.set(key, bucket);
  }

  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const retryAfterMs = Math.ceil((1 - bucket.tokens) / refillRate * 1000);
    return { ok: false, tokens: 0, retryAfterMs };
  }

  bucket.tokens -= 1;
  return { ok: true, tokens: Math.floor(bucket.tokens), retryAfterMs: 0 };
}

// ── In-memory sliding window ─────────────────────────────

function slidingWindowMem(
  key: string,
  maxRequests: number,
  windowMs: number,
): { ok: boolean; remaining: number; retryAfterMs: number } {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = memWindowStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    memWindowStore.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const resetMs = oldest + windowMs - now;
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, resetMs) };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: maxRequests - entry.timestamps.length, retryAfterMs: 0 };
}

// ── Circuit breaker for Redis ────────────────────────────
//
// If Redis becomes unavailable mid-flight, we fall back to in-memory
// rather than returning 500. This is a "fail-open-with-degradation" policy:
//   - Redis healthy   → shared distributed rate limiting (correct)
//   - Redis down      → per-instance in-memory limiting (degraded but functional)
//
// The breaker tracks consecutive failures. After BREAKER_THRESHOLD failures
// it "trips" and stops attempting Redis for BREAKER_COOLDOWN_MS, avoiding
// retry latency on every request during an outage.

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 30_000; // 30 seconds

let _redisChecked = false;
let _redis: Redis | null = null;
let _breakerFailures = 0;
let _breakerOpenUntil = 0;

function redis(): Redis | null {
  if (!_redisChecked) {
    _redis = getRedis();
    _redisChecked = true;
  }
  // Circuit breaker is open — skip Redis until cooldown expires
  if (_breakerOpenUntil > Date.now()) return null;
  // If cooldown expired, reset breaker and try again
  if (_breakerFailures >= BREAKER_THRESHOLD) {
    _breakerFailures = 0;
    _breakerOpenUntil = 0;
  }
  return _redis;
}

/** Called when a Redis operation succeeds — resets the breaker. */
function breakerSuccess(): void {
  if (_breakerFailures > 0) {
    _breakerFailures = 0;
    _breakerOpenUntil = 0;
  }
}

/** Called when a Redis operation fails — increments failures and may trip the breaker. */
function breakerFail(err: unknown): void {
  _breakerFailures++;
  if (_breakerFailures >= BREAKER_THRESHOLD) {
    _breakerOpenUntil = Date.now() + BREAKER_COOLDOWN_MS;
    console.warn(`[rate-limit] Circuit breaker OPEN — Redis failed ${_breakerFailures} times. Falling back to in-memory for ${BREAKER_COOLDOWN_MS / 1000}s.`, (err as Error)?.message);
  }
}

// ── Redis-backed implementations ─────────────────────────

async function consumeTokenRedis(
  redisClient: Redis,
  key: string,
  capacity: number,
  refillRate: number,
): Promise<{ ok: boolean; tokens: number; retryAfterMs: number }> {
  const ttl = Math.ceil(capacity / refillRate) + 10; // key TTL: time to fully refill + buffer
  const result = await redisClient.eval(
    TOKEN_BUCKET_LUA,
    [`rl:bucket:${key}`],
    [capacity, refillRate, Date.now(), ttl],
  ) as [number, number, number];
  return { ok: result[0] === 1, tokens: result[1], retryAfterMs: result[2] };
}

async function slidingWindowRedis(
  redisClient: Redis,
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ ok: boolean; remaining: number; retryAfterMs: number }> {
  const ttl = Math.ceil(windowMs / 1000) + 10;
  // Unique member: timestamp + random suffix
  const member = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await redisClient.eval(
    SLIDING_WINDOW_LUA,
    [`rl:window:${key}`],
    [Date.now(), windowMs, maxRequests, member, ttl],
  ) as [number, number, number];
  return { ok: result[0] === 1, remaining: result[1], retryAfterMs: result[2] };
}

// ── Helpers for building response ────────────────────────

function buildHeaders(
  maxRequests: number,
  remaining: number,
  resetMs: number,
): Record<string, string> {
  const now = Date.now();
  return {
    'X-RateLimit-Limit': maxRequests.toString(),
    'X-RateLimit-Remaining': Math.max(0, remaining).toString(),
    'X-RateLimit-Reset': Math.ceil((now + resetMs) / 1000).toString(),
  };
}

function rejectResult(
  error: string,
  maxRequests: number,
  retryAfterMs: number,
): RateLimitResult {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return {
    ok: false,
    remaining: 0,
    error,
    headers: {
      'Retry-After': retryAfterSec.toString(),
      ...buildHeaders(maxRequests, 0, retryAfterMs),
    },
  };
}

// ── Main rate limit function ─────────────────────────────

/**
 * Check rate limit for a given key. Enforces both token-bucket burst
 * control and sliding-window sustained rate.
 *
 * Uses Redis when Upstash env vars are configured, otherwise falls back
 * to in-memory Maps. The Redis path uses atomic Lua scripts — safe for
 * multiple carrier instances sharing the same Redis.
 */
export async function rateLimit(
  key: string,
  opts: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const maxRequests = opts.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const capacity = opts.bucketCapacity ?? DEFAULT_BUCKET_CAPACITY;
  const refillRate = opts.refillRate ?? DEFAULT_REFILL_RATE;

  const r = redis();

  // Layer 1: Token bucket (burst control)
  let bucket: { ok: boolean; tokens: number; retryAfterMs: number };
  if (r) {
    try {
      bucket = await consumeTokenRedis(r, key, capacity, refillRate);
      breakerSuccess();
    } catch (err) {
      breakerFail(err);
      bucket = consumeTokenMem(key, capacity, refillRate);
    }
  } else {
    bucket = consumeTokenMem(key, capacity, refillRate);
  }

  if (!bucket.ok) {
    return rejectResult(
      `Rate limit exceeded — burst limit (max ${capacity} concurrent). Retry after ${Math.ceil(bucket.retryAfterMs / 1000)}s.`,
      maxRequests,
      bucket.retryAfterMs,
    );
  }

  // Layer 2: Sliding window (sustained rate)
  let window: { ok: boolean; remaining: number; retryAfterMs: number };
  if (r) {
    try {
      window = await slidingWindowRedis(r, key, maxRequests, windowMs);
      breakerSuccess();
    } catch (err) {
      breakerFail(err);
      window = slidingWindowMem(key, maxRequests, windowMs);
    }
  } else {
    window = slidingWindowMem(key, maxRequests, windowMs);
  }

  if (!window.ok) {
    return rejectResult(
      `Rate limit exceeded (${maxRequests} requests per ${windowMs / 1000}s)`,
      maxRequests,
      window.retryAfterMs,
    );
  }

  return {
    ok: true,
    remaining: window.remaining,
    headers: buildHeaders(maxRequests, window.remaining, windowMs),
  };
}

/**
 * Per-caller-target rate limit. Prevents one caller from flooding
 * a single target agent.
 */
export async function rateLimitPerTarget(
  callerKey: string,
  targetMoltNumber: string,
  limit = DEFAULT_PER_TARGET_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): Promise<RateLimitResult> {
  const key = `target:${callerKey}:${targetMoltNumber}`;
  return rateLimit(key, { maxRequests: limit, windowMs, bucketCapacity: 5, refillRate: 1 });
}

/**
 * Derive a rate-limit key from the request.
 * Prefers X-Molt-Caller (agent identity) → X-Forwarded-For → X-Real-IP → "unknown".
 */
export function rateLimitKey(req: Request): string {
  const caller = req.headers.get('x-molt-caller');
  if (caller) return `agent:${caller}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';
  return `ip:${ip}`;
}
