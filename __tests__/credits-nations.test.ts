/**
 * Tests for nation creation credit guards and nation graduation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockPrisma = {
  user: { findUnique: jest.fn() },
  nation: {
    count: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  creditTransaction: { create: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('@/carrier.config', () => ({
  ...jest.requireActual('@/carrier.config'),
  CREDITS_ENABLED: true,
}));

import {
  canCreateNation,
  checkNationGraduation,
  MAX_NATIONS_PER_USER,
  NATION_CREATION_COST,
  NATION_CREATION_COOLDOWN_S,
  NATION_MIN_AGENTS_TO_GRADUATE,
  RESERVED_NATION_CODES,
} from '@/lib/services/credits';

const TEST_USER_ID = 'test-user-id';

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Reserved codes ───────────────────────────────────────

describe('RESERVED_NATION_CODES', () => {
  it('includes MOLT, TEST, XXXX, NULL, VOID', () => {
    expect(RESERVED_NATION_CODES).toContain('MOLT');
    expect(RESERVED_NATION_CODES).toContain('TEST');
    expect(RESERVED_NATION_CODES).toContain('XXXX');
    expect(RESERVED_NATION_CODES).toContain('NULL');
    expect(RESERVED_NATION_CODES).toContain('VOID');
  });
});

// ── canCreateNation ──────────────────────────────────────

describe('canCreateNation', () => {
  it('succeeds for verified user with credits and no existing nations', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      credits: 10000,
    });
    mockPrisma.nation.count.mockResolvedValue(0);
    mockPrisma.nation.findFirst.mockResolvedValue(null);

    const result = await canCreateNation(TEST_USER_ID);
    expect(result).toEqual({ ok: true });
  });

  it('rejects user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const result = await canCreateNation(TEST_USER_ID);
    expect(result).toEqual({ ok: false, reason: expect.stringMatching(/not found/i) });
  });

  it('rejects unverified email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: null,
      credits: 10000,
    });

    const result = await canCreateNation(TEST_USER_ID);
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/verify.*email/i);
  });

  it('rejects when nation quota reached', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      credits: 10000,
    });
    mockPrisma.nation.count.mockResolvedValue(MAX_NATIONS_PER_USER);

    const result = await canCreateNation(TEST_USER_ID);
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/limit/i);
  });

  it('rejects when within cooldown period', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      credits: 10000,
    });
    mockPrisma.nation.count.mockResolvedValue(0);
    // Last nation created 1 second ago
    mockPrisma.nation.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - 1000),
    });

    const result = await canCreateNation(TEST_USER_ID);
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/wait/i);
  });

  it('allows when cooldown has elapsed', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      credits: 10000,
    });
    mockPrisma.nation.count.mockResolvedValue(0);
    // Last nation created well past cooldown
    mockPrisma.nation.findFirst.mockResolvedValue({
      createdAt: new Date(Date.now() - (NATION_CREATION_COOLDOWN_S + 10) * 1000),
    });

    const result = await canCreateNation(TEST_USER_ID);
    expect(result).toEqual({ ok: true });
  });

  it('rejects insufficient credits', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      emailVerifiedAt: new Date(),
      credits: NATION_CREATION_COST - 1,
    });
    mockPrisma.nation.count.mockResolvedValue(0);
    mockPrisma.nation.findFirst.mockResolvedValue(null);

    const result = await canCreateNation(TEST_USER_ID);
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/insufficient.*credits/i);
  });
});

// ── checkNationGraduation ────────────────────────────────

describe('checkNationGraduation', () => {
  it('graduates a provisional nation with enough agents', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      provisionalUntil: new Date(Date.now() + 86400000),
      _count: { agents: NATION_MIN_AGENTS_TO_GRADUATE },
    });
    mockPrisma.nation.update.mockResolvedValue({});

    const result = await checkNationGraduation('SOLR');
    expect(result).toBe(true);
    expect(mockPrisma.nation.update).toHaveBeenCalledWith({
      where: { code: 'SOLR' },
      data: { provisionalUntil: null },
    });
  });

  it('does not graduate a nation with too few agents', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      provisionalUntil: new Date(Date.now() + 86400000),
      _count: { agents: NATION_MIN_AGENTS_TO_GRADUATE - 1 },
    });

    const result = await checkNationGraduation('SOLR');
    expect(result).toBe(false);
    expect(mockPrisma.nation.update).not.toHaveBeenCalled();
  });

  it('returns false for already graduated nations', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      provisionalUntil: null, // already graduated
      _count: { agents: 20 },
    });

    const result = await checkNationGraduation('SOLR');
    expect(result).toBe(false);
  });

  it('returns false for non-existent nations', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(null);

    const result = await checkNationGraduation('NOPE');
    expect(result).toBe(false);
  });
});

// ── Constants ────────────────────────────────────────────

describe('Nation creation constants', () => {
  it('has correct cost', () => {
    expect(NATION_CREATION_COST).toBe(500);
  });

  it('has correct quota', () => {
    expect(MAX_NATIONS_PER_USER).toBe(3);
  });

  it('has correct cooldown (24h)', () => {
    expect(NATION_CREATION_COOLDOWN_S).toBe(86400);
  });

  it('has correct graduation threshold', () => {
    expect(NATION_MIN_AGENTS_TO_GRADUATE).toBe(10);
  });
});
