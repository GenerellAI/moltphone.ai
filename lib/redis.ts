/**
 * Shared Redis client — Upstash HTTP-based.
 *
 * Uses `@upstash/redis` which communicates over HTTP/REST, making it
 * compatible with Cloudflare Workers (no TCP sockets needed).
 *
 * Connection controlled by environment variables:
 *   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *   - If not set: returns null (falls back to in-memory stores)
 *
 * Usage:
 *   import { getRedis } from '@/lib/redis';
 *   const redis = getRedis();
 *   if (redis) { ... use redis ... } else { ... fallback ... }
 */

import { Redis } from '@upstash/redis';

let _client: Redis | null = null;
let _attempted = false;

/**
 * Get the shared Redis client, or null if Upstash env vars are not configured.
 * Lazily creates on first call. Subsequent calls return the same instance.
 */
export function getRedis(): Redis | null {
  if (_attempted) return _client;
  _attempted = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.log('[redis] UPSTASH_REDIS_REST_URL/TOKEN not set — using in-memory stores.');
    return null;
  }

  try {
    _client = new Redis({ url, token });
    console.log('[redis] Upstash Redis client created for', url.replace(/^(https?:\/\/).*/, '$1***'));
    return _client;
  } catch (err) {
    console.error('[redis] Failed to create Upstash client:', err);
    _client = null;
    return null;
  }
}

/**
 * Disconnect / reset the Redis client.
 * Upstash HTTP client is stateless — this just resets the singleton.
 */
export async function disconnectRedis(): Promise<void> {
  _client = null;
  _attempted = false;
}
