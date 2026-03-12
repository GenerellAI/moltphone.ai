/**
 * Tests for nonce deduplication (replay protection).
 *
 * Since Redis is not available in unit tests (no Upstash env vars), these tests
 * exercise the PostgreSQL fallback path via a mocked Prisma client.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock Redis — return null (no Redis URL configured)
jest.mock('@/lib/redis', () => ({
  getRedis: jest.fn().mockReturnValue(null),
}));

// Mock Prisma
const mockPrisma = {
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { isNonceReplay } from '../lib/nonce';

describe('Nonce Dedup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns false for a fresh nonce (not replayed)', async () => {
    mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
    mockPrisma.nonceUsed.create.mockResolvedValue({});

    const result = await isNonceReplay('SOLR-AAAA:abc123');

    expect(result).toBe(false);
    expect(mockPrisma.nonceUsed.findUnique).toHaveBeenCalledWith({
      where: { nonce: 'SOLR-AAAA:abc123' },
    });
    expect(mockPrisma.nonceUsed.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nonce: 'SOLR-AAAA:abc123',
        expiresAt: expect.any(Date),
      }),
    });
  });

  it('returns true for a replayed nonce', async () => {
    mockPrisma.nonceUsed.findUnique.mockResolvedValue({ nonce: 'SOLR-AAAA:abc123' });

    const result = await isNonceReplay('SOLR-AAAA:abc123');

    expect(result).toBe(true);
    // Should NOT attempt to create — replay detected before insert
    expect(mockPrisma.nonceUsed.create).not.toHaveBeenCalled();
  });

  it('sets expiry ~10 minutes in the future', async () => {
    mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
    mockPrisma.nonceUsed.create.mockResolvedValue({});

    const before = Date.now();
    await isNonceReplay('test:nonce1');
    const after = Date.now();

    const createCall = mockPrisma.nonceUsed.create.mock.calls[0][0];
    const expiresAt = createCall.data.expiresAt.getTime();

    // Should be 600 seconds (10 min) in the future, ±1 second tolerance
    expect(expiresAt).toBeGreaterThanOrEqual(before + 599_000);
    expect(expiresAt).toBeLessThanOrEqual(after + 601_000);
  });

  it('isolates different nonce keys', async () => {
    mockPrisma.nonceUsed.findUnique
      .mockResolvedValueOnce({ nonce: 'agent-A:n1' })   // first: replayed
      .mockResolvedValueOnce(null);                       // second: fresh
    mockPrisma.nonceUsed.create.mockResolvedValue({});

    expect(await isNonceReplay('agent-A:n1')).toBe(true);
    expect(await isNonceReplay('agent-B:n2')).toBe(false);
  });
});
