/**
 * Tests for endpoint URL ownership deduplication.
 *
 * Prevents DoS amplification by ensuring an endpointUrl can only be
 * registered by one owner at a time. Same owner can share a URL across
 * their own agents.
 */
const mockPrisma = {
  agent: {
    findFirst: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { checkEndpointOwnership } from '../lib/ssrf';

const URL_A = 'https://example.com/webhook';

describe('checkEndpointOwnership', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows URL not used by any agent', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    const result = await checkEndpointOwnership(URL_A, 'user-1');
    expect(result.ok).toBe(true);
  });

  it('rejects URL already owned by a different user', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue({ id: 'agent-other' });
    const result = await checkEndpointOwnership(URL_A, 'user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/already registered/i);
    }
  });

  it('passes correct where clause for owned check', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    await checkEndpointOwnership(URL_A, 'user-1');

    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
      where: {
        endpointUrl: URL_A,
        isActive: true,
        ownerId: { not: 'user-1' },
      },
      select: { id: true },
    });
  });

  it('excludes the current agent when excludeAgentId is provided (PATCH)', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    await checkEndpointOwnership(URL_A, 'user-1', 'agent-1');

    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
      where: {
        endpointUrl: URL_A,
        isActive: true,
        id: { not: 'agent-1' },
        ownerId: { not: 'user-1' },
      },
      select: { id: true },
    });
  });

  it('uses ownerId: { not: null } for self-signup (unclaimed agents)', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    await checkEndpointOwnership(URL_A, null);

    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
      where: {
        endpointUrl: URL_A,
        isActive: true,
        ownerId: { not: null },
      },
      select: { id: true },
    });
  });

  it('rejects self-signup URL if any owned agent has it', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue({ id: 'agent-owned' });
    const result = await checkEndpointOwnership(URL_A, null);
    expect(result.ok).toBe(false);
  });

  it('strips trailing slashes before querying', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);
    await checkEndpointOwnership('https://example.com/webhook///', 'user-1');

    expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          endpointUrl: 'https://example.com/webhook',
        }),
      }),
    );
  });
});
