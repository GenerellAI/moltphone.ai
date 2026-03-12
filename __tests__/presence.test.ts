/**
 * Tests for presence module.
 */
import { isOnline, PRESENCE_TTL_SECONDS } from '../lib/presence';

describe('Presence', () => {
  it('returns false when lastSeenAt is null', () => {
    expect(isOnline(null)).toBe(false);
  });

  it('returns true when lastSeenAt is recent (within TTL)', () => {
    expect(isOnline(new Date())).toBe(true);
  });

  it('returns true at exactly TTL boundary', () => {
    const boundary = new Date(Date.now() - PRESENCE_TTL_SECONDS * 1000);
    expect(isOnline(boundary)).toBe(true);
  });

  it('returns false when lastSeenAt exceeds TTL', () => {
    const past = new Date(Date.now() - (PRESENCE_TTL_SECONDS + 10) * 1000);
    expect(isOnline(past)).toBe(false);
  });

  it('returns false for far-past dates', () => {
    expect(isOnline(new Date('2020-01-01'))).toBe(false);
  });

  it('returns true for just-now dates', () => {
    expect(isOnline(new Date(Date.now() - 1000))).toBe(true);
  });
});
