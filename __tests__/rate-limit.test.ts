/**
 * Tests for token-bucket + sliding-window rate limiter.
 */
import { rateLimit } from '../lib/rate-limit';

describe('Rate Limiter', () => {
  // Use a high bucket capacity so these tests focus on the sliding window layer
  const highBucket = { bucketCapacity: 100, refillRate: 100 };

  it('allows requests within limit', async () => {
    const key = `test-allow-${Date.now()}`;
    const result = await rateLimit(key, { maxRequests: 10, windowMs: 60_000, ...highBucket });
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('tracks remaining correctly', async () => {
    const key = `test-remaining-${Date.now()}`;
    const r1 = await rateLimit(key, { maxRequests: 5, windowMs: 60_000, ...highBucket });
    expect(r1.remaining).toBe(4);
    const r2 = await rateLimit(key, { maxRequests: 5, windowMs: 60_000, ...highBucket });
    expect(r2.remaining).toBe(3);
    const r3 = await rateLimit(key, { maxRequests: 5, windowMs: 60_000, ...highBucket });
    expect(r3.remaining).toBe(2);
  });

  it('blocks requests exceeding limit', async () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = await rateLimit(key, { maxRequests: 3, windowMs: 60_000, ...highBucket });
      expect(r.ok).toBe(true);
    }
    const blocked = await rateLimit(key, { maxRequests: 3, windowMs: 60_000, ...highBucket });
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.error).toBeDefined();
  });

  it('isolates different keys', async () => {
    const key1 = `test-iso1-${Date.now()}`;
    const key2 = `test-iso2-${Date.now()}`;
    for (let i = 0; i < 3; i++) await rateLimit(key1, { maxRequests: 3, windowMs: 60_000, ...highBucket });
    // key1 should be blocked
    expect((await rateLimit(key1, { maxRequests: 3, windowMs: 60_000, ...highBucket })).ok).toBe(false);
    // key2 should still be allowed
    expect((await rateLimit(key2, { maxRequests: 3, windowMs: 60_000, ...highBucket })).ok).toBe(true);
  });

  it('allows requests after window expires', async () => {
    const key = `test-expire-${Date.now()}`;
    // Use a very short window (50ms)
    for (let i = 0; i < 2; i++) await rateLimit(key, { maxRequests: 2, windowMs: 50, ...highBucket });
    expect((await rateLimit(key, { maxRequests: 2, windowMs: 50, ...highBucket })).ok).toBe(false);
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 60));
    expect((await rateLimit(key, { maxRequests: 2, windowMs: 50, ...highBucket })).ok).toBe(true);
  });

  it('returns rate-limit headers on rejection', async () => {
    const key = `test-headers-${Date.now()}`;
    for (let i = 0; i < 2; i++) await rateLimit(key, { maxRequests: 2, windowMs: 60_000, ...highBucket });
    const blocked = await rateLimit(key, { maxRequests: 2, windowMs: 60_000, ...highBucket });
    expect(blocked.ok).toBe(false);
    expect(blocked.headers).toBeDefined();
    expect(blocked.headers!['Retry-After']).toBeDefined();
    expect(blocked.headers!['X-RateLimit-Limit']).toBe('2');
    expect(blocked.headers!['X-RateLimit-Remaining']).toBe('0');
    expect(blocked.headers!['X-RateLimit-Reset']).toBeDefined();
  });

  it('returns rate-limit headers on success', async () => {
    const key = `test-headers-ok-${Date.now()}`;
    const result = await rateLimit(key, { maxRequests: 10, windowMs: 60_000, ...highBucket });
    expect(result.ok).toBe(true);
    expect(result.headers).toBeDefined();
    expect(result.headers!['X-RateLimit-Limit']).toBe('10');
    expect(result.headers!['X-RateLimit-Remaining']).toBe('9');
  });

  it('enforces burst limit via token bucket', async () => {
    const key = `test-burst-${Date.now()}`;
    // Allow only 3 burst tokens, high sustained limit
    const results: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      results.push((await rateLimit(key, { maxRequests: 100, windowMs: 60_000, bucketCapacity: 3, refillRate: 0.001 })).ok);
    }
    // First 3 should succeed (initial bucket capacity), 4th+ should fail
    expect(results.slice(0, 3)).toEqual([true, true, true]);
    expect(results[3]).toBe(false);
  });
});
