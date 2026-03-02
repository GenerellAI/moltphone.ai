/**
 * Tests for in-memory sliding-window rate limiter.
 */
import { rateLimit } from '../lib/rate-limit';

describe('Rate Limiter', () => {
  it('allows requests within limit', () => {
    const key = `test-allow-${Date.now()}`;
    const result = rateLimit(key, 10, 60_000);
    expect(result.ok).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('tracks remaining correctly', () => {
    const key = `test-remaining-${Date.now()}`;
    const r1 = rateLimit(key, 5, 60_000);
    expect(r1.remaining).toBe(4);
    const r2 = rateLimit(key, 5, 60_000);
    expect(r2.remaining).toBe(3);
    const r3 = rateLimit(key, 5, 60_000);
    expect(r3.remaining).toBe(2);
  });

  it('blocks requests exceeding limit', () => {
    const key = `test-block-${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      const r = rateLimit(key, 3, 60_000);
      expect(r.ok).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.error).toBeDefined();
  });

  it('isolates different keys', () => {
    const key1 = `test-iso1-${Date.now()}`;
    const key2 = `test-iso2-${Date.now()}`;
    for (let i = 0; i < 3; i++) rateLimit(key1, 3, 60_000);
    // key1 should be blocked
    expect(rateLimit(key1, 3, 60_000).ok).toBe(false);
    // key2 should still be allowed
    expect(rateLimit(key2, 3, 60_000).ok).toBe(true);
  });

  it('allows requests after window expires', async () => {
    const key = `test-expire-${Date.now()}`;
    // Use a very short window (50ms)
    for (let i = 0; i < 2; i++) rateLimit(key, 2, 50);
    expect(rateLimit(key, 2, 50).ok).toBe(false);
    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(rateLimit(key, 2, 50).ok).toBe(true);
  });
});
