/**
 * Tests for credits constants, exports, and size-based pricing.
 * DB-dependent functions (grant, deduct, refund) require integration tests.
 */
import {
  SIGNUP_CREDITS,
  BASE_MESSAGE_COST,
  FREE_TIER_BYTES,
  COST_PER_CHUNK,
  CHUNK_SIZE_BYTES,
  calculateMessageCost,
} from '../lib/services/credits';

describe('Credits', () => {
  it('SIGNUP_CREDITS is a generous amount', () => {
    expect(SIGNUP_CREDITS).toBeGreaterThanOrEqual(1000);
    expect(typeof SIGNUP_CREDITS).toBe('number');
  });

  it('BASE_MESSAGE_COST is a positive integer', () => {
    expect(BASE_MESSAGE_COST).toBeGreaterThan(0);
    expect(Number.isInteger(BASE_MESSAGE_COST)).toBe(true);
  });

  it('FREE_TIER_BYTES is 4KB', () => {
    expect(FREE_TIER_BYTES).toBe(4096);
  });

  it('CHUNK_SIZE_BYTES is 4KB', () => {
    expect(CHUNK_SIZE_BYTES).toBe(4096);
  });

  it('SIGNUP_CREDITS covers many tasks', () => {
    // At minimum, signup credits should cover 1000+ base-cost tasks
    expect(SIGNUP_CREDITS / BASE_MESSAGE_COST).toBeGreaterThanOrEqual(1000);
  });
});

describe('calculateMessageCost', () => {
  it('returns BASE_MESSAGE_COST for a short text message', () => {
    const msg = JSON.stringify({ message: { parts: [{ type: 'text', text: 'Hello!' }] } });
    expect(calculateMessageCost(msg)).toBe(BASE_MESSAGE_COST);
  });

  it('returns BASE_MESSAGE_COST for messages at exactly FREE_TIER_BYTES', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST);
  });

  it('charges 1 extra credit for 1 byte over the free tier', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES + 1);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + COST_PER_CHUNK);
  });

  it('charges 1 extra credit for exactly 1 chunk over the free tier', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES + CHUNK_SIZE_BYTES);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + COST_PER_CHUNK);
  });

  it('charges 2 extra credits for 1 chunk + 1 byte over the free tier', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES + CHUNK_SIZE_BYTES + 1);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + 2 * COST_PER_CHUNK);
  });

  it('charges correctly for a 20KB message', () => {
    const body = 'x'.repeat(20 * 1024);
    // 20KB - 4KB = 16KB → ceil(16KB / 4KB) = 4 chunks
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + 4 * COST_PER_CHUNK);
  });

  it('charges correctly for a 100KB message', () => {
    const body = 'x'.repeat(100 * 1024);
    // 100KB - 4KB = 96KB → ceil(96KB / 4KB) = 24 chunks
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + 24 * COST_PER_CHUNK);
  });

  it('handles Buffer input', () => {
    const buf = Buffer.alloc(FREE_TIER_BYTES + CHUNK_SIZE_BYTES * 3);
    expect(calculateMessageCost(buf)).toBe(BASE_MESSAGE_COST + 3 * COST_PER_CHUNK);
  });

  it('handles empty string', () => {
    expect(calculateMessageCost('')).toBe(BASE_MESSAGE_COST);
  });

  it('accounts for multi-byte UTF-8 characters', () => {
    // Each emoji is 4 bytes in UTF-8
    const emojis = '😀'.repeat(1025); // 1025 * 4 = 4100 bytes > FREE_TIER_BYTES
    expect(calculateMessageCost(emojis)).toBe(BASE_MESSAGE_COST + COST_PER_CHUNK);
  });
});
