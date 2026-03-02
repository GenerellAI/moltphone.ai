/**
 * In-memory sliding-window rate limiter.
 *
 * Tracks request counts per key (IP or agent ID) in a Map.  Good enough for
 * single-process deployments; swap for Redis when scaling horizontally.
 *
 * Usage:
 *   const result = rateLimit(key);
 *   if (!result.ok) return moltErrorResponse(MOLT_RATE_LIMITED, result.error);
 */

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 60;  // 60 req/min per key

interface Entry {
  timestamps: number[];
}

const store = new Map<string, Entry>();

// Periodic cleanup every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - DEFAULT_WINDOW_MS * 2;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}, 5 * 60_000);

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  error?: string;
}

export function rateLimit(
  key: string,
  maxRequests = DEFAULT_MAX_REQUESTS,
  windowMs = DEFAULT_WINDOW_MS,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Prune expired entries
  entry.timestamps = entry.timestamps.filter(t => t > windowStart);

  if (entry.timestamps.length >= maxRequests) {
    return {
      ok: false,
      remaining: 0,
      error: `Rate limit exceeded (${maxRequests} requests per ${windowMs / 1000}s)`,
    };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: maxRequests - entry.timestamps.length };
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
