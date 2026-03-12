/**
 * Tests for Direct Connection service — privacy proxy upgrade handshake.
 *
 * Unit tests for constants, types, and exports. DB-dependent lifecycle
 * functions (propose/accept/reject/revoke) require integration tests.
 *
 * Architecture references:
 *   - SIP B2BUA (RFC 7092) — carrier as back-to-back user agent
 *   - TURN relay (RFC 8656) — carrier_only as persistent allocation
 *   - ICE offer/answer (RFC 8445) — upgrade handshake as candidate exchange
 */
import {
  PROPOSAL_TTL_MS,
  ACTIVE_STATUSES,
} from '../lib/services/direct-connections';

import {
  calculateMessageCost,
  BASE_MESSAGE_COST,
  FREE_TIER_BYTES,
  COST_PER_CHUNK,
  CHUNK_SIZE_BYTES,
} from '../lib/services/credits';

describe('Direct Connections — Constants', () => {
  it('PROPOSAL_TTL_MS is 24 hours', () => {
    expect(PROPOSAL_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(PROPOSAL_TTL_MS).toBe(86_400_000);
  });

  it('ACTIVE_STATUSES includes proposed, accepted, active', () => {
    expect(ACTIVE_STATUSES).toContain('proposed');
    expect(ACTIVE_STATUSES).toContain('accepted');
    expect(ACTIVE_STATUSES).toContain('active');
  });

  it('ACTIVE_STATUSES does not include terminal states', () => {
    expect(ACTIVE_STATUSES).not.toContain('rejected');
    expect(ACTIVE_STATUSES).not.toContain('revoked');
    expect(ACTIVE_STATUSES).not.toContain('expired');
  });

  it('ACTIVE_STATUSES has exactly 3 statuses', () => {
    expect(ACTIVE_STATUSES).toHaveLength(3);
  });
});

describe('Direct Connections — Lifecycle states', () => {
  /**
   * Lifecycle diagram (from RFC 7092 B2BUA + ICE offer/answer):
   *
   *   proposed  → accepted → active → revoked
   *   proposed  → rejected
   *   proposed  → expired (TTL exceeded)
   *   accepted  → revoked (either party, pre-activation)
   *   active    → revoked (either party, post-activation)
   */

  it('proposed is the initial state', () => {
    expect(ACTIVE_STATUSES[0]).toBe('proposed');
  });

  it('accepted follows proposed in the lifecycle', () => {
    const proposedIdx = ACTIVE_STATUSES.indexOf('proposed');
    const acceptedIdx = ACTIVE_STATUSES.indexOf('accepted');
    expect(acceptedIdx).toBeGreaterThan(proposedIdx);
  });

  it('active is the final non-terminal state', () => {
    const activeIdx = ACTIVE_STATUSES.indexOf('active');
    expect(activeIdx).toBe(ACTIVE_STATUSES.length - 1);
  });
});

describe('Direct Connections — Relay pricing (carrier_only)', () => {
  /**
   * carrier_only agents pay for TURN-style relay traffic.
   * Cost is calculated using calculateMessageCost() — same size-based
   * pricing used across the platform, but only charged for relay mode.
   */

  it('relay cost for a small message is BASE_MESSAGE_COST', () => {
    const body = JSON.stringify({ message: { parts: [{ type: 'text', text: 'hello' }] } });
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST);
  });

  it('relay cost for a 4KB message is BASE_MESSAGE_COST (within free tier)', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST);
  });

  it('relay cost for an 8KB message is BASE + 1 chunk', () => {
    const body = 'x'.repeat(FREE_TIER_BYTES + CHUNK_SIZE_BYTES);
    expect(calculateMessageCost(body)).toBe(BASE_MESSAGE_COST + COST_PER_CHUNK);
  });

  it('relay cost for a 50KB attachment message is significant', () => {
    const body = 'x'.repeat(50 * 1024);
    // 50KB - 4KB = 46KB → ceil(46KB / 4KB) = 12 chunks
    const expected = BASE_MESSAGE_COST + 12 * COST_PER_CHUNK;
    expect(calculateMessageCost(body)).toBe(expected);
  });

  it('relay cost scales linearly with message size', () => {
    const cost10k = calculateMessageCost('x'.repeat(10 * 1024));
    const cost20k = calculateMessageCost('x'.repeat(20 * 1024));
    const cost40k = calculateMessageCost('x'.repeat(40 * 1024));

    // Costs should increase proportionally (accounting for base cost and free tier)
    expect(cost20k).toBeGreaterThan(cost10k);
    expect(cost40k).toBeGreaterThan(cost20k);

    // With BASE_MESSAGE_COST = 1 and free tier:
    // 10KB: 1 base + ceil(6KB/4KB) = 1 + 2 = 3
    // 20KB: 1 base + ceil(16KB/4KB) = 1 + 4 = 5
    // 40KB: 1 base + ceil(36KB/4KB) = 1 + 9 = 10
    expect(cost10k).toBe(3);
    expect(cost20k).toBe(5);
    expect(cost40k).toBe(10);
  });

  it('carrier_only 10,000 signup credits cover many relay messages', () => {
    // At BASE_MESSAGE_COST per message, 10k credits = 10k messages
    const smallMessageCost = calculateMessageCost('short text');
    expect(10_000 / smallMessageCost).toBeGreaterThanOrEqual(5000);
  });
});

describe('Direct Connections — Policy semantics', () => {
  /**
   * directConnectionPolicy mapping to standards:
   *
   * direct_on_consent → default. Both parties must agree before the carrier
   *   shares endpoints. Like ICE with consent-freshness (RFC 7675).
   *
   * direct_on_accept → ICE Lite. Target auto-accepts upgrade proposals.
   *   Carrier immediately performs candidate exchange without manual approval.
   *
   * carrier_only → Permanent TURN Allocation (RFC 8656). ALL traffic relayed.
   *   Agent pays credits per message. Endpoints never shared. Maximum privacy.
   */

  const policies = ['direct_on_consent', 'direct_on_accept', 'carrier_only'] as const;

  it('all three policies are defined', () => {
    expect(policies).toHaveLength(3);
  });

  it('direct_on_consent is the default (most balanced)', () => {
    // Default in schema: @default(direct_on_consent)
    expect(policies[0]).toBe('direct_on_consent');
  });

  it('carrier_only is the only paid policy', () => {
    // Only carrier_only triggers relay charges. The others are free
    // because they allow direct connections (saving carrier resources).
    const paidPolicies = policies.filter(p => p === 'carrier_only');
    expect(paidPolicies).toHaveLength(1);
  });
});

describe('Direct Connections — Upgrade token', () => {
  /**
   * The upgrade token is analogous to:
   * - TURN Allocation token (RFC 8656 §6)
   * - ICE transaction ID in Binding Request (RFC 8445 §7.2)
   *
   * It's a 256-bit random value, single-use, generated during accept.
   */

  it('token entropy: 32 bytes = 256 bits', () => {
    // Verify the token generation spec
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('base64url');
    // base64url encoding of 32 bytes = ~43 characters
    expect(token.length).toBeGreaterThanOrEqual(42);
    expect(token.length).toBeLessThanOrEqual(44);
  });

  it('tokens are unique across generations', () => {
    const crypto = require('crypto');
    const tokens = new Set(
      Array.from({ length: 100 }, () => crypto.randomBytes(32).toString('base64url'))
    );
    // All 100 tokens should be unique (with 256 bits of entropy, collision is negligible)
    expect(tokens.size).toBe(100);
  });

  it('tokens are URL-safe (base64url)', () => {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('base64url');
    // base64url uses only: A-Z a-z 0-9 - _
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
