/**
 * Integration tests for /api/agents/claim (claim an unclaimed agent)
 * and /api/agents/claim/preview (public preview).
 *
 * Tests: auth, token validation, expiry, email verification,
 * Sybil guards, credit deduction, claim preview.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  TEST_USER,
  buildRequest,
  mockSession,
  buildMockAgent,
  resetAgentCounter,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  nation: {
    findUnique: jest.fn(),
  },
  nonceUsed: { findUnique: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

const mockCanCreateAgent = jest.fn().mockResolvedValue({ ok: true });
const mockDeductCredits = jest.fn().mockResolvedValue({ ok: true });
jest.mock('@/lib/services/credits', () => ({
  canCreateAgent: (...args: any[]) => mockCanCreateAgent(...args),
  deductAgentCreationCredits: (...args: any[]) => mockDeductCredits(...args),
  AGENT_CREATION_COST: 100,
}));

const mockSendClaimEmail = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/email', () => ({
  sendClaimNotificationEmail: (...args: any[]) => mockSendClaimEmail(...args),
}));

// ── Import routes ────────────────────────────────────────

import { POST as claimAgent } from '../../app/api/agents/claim/route';
import { GET as claimPreview } from '../../app/api/agents/claim/preview/route';

// ── Test data ────────────────────────────────────────────

const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const pastDate = new Date(Date.now() - 1000);

function mockUnclaimedAgent(overrides: Record<string, any> = {}) {
  return {
    id: 'agent-unclaimed-1',
    moltNumber: 'MPHO-XXXX-YYYY-ZZZZ-AAAA',
    displayName: 'Unclaimed Bot',
    nationCode: 'MPHO',
    description: 'A self-signed agent',
    skills: ['call', 'text'],
    ownerId: null,
    claimToken: 'valid-claim-token-123',
    claimExpiresAt: futureDate,
    isActive: true,
    nation: { code: 'MPHO', displayName: 'MoltPhone', badge: '⚡' },
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockGetServerSession.mockResolvedValue(mockSession());
  mockPrisma.user.findUnique.mockResolvedValue({
    id: TEST_USER.id,
    emailVerifiedAt: new Date(),
    email: 'test@example.com',
    name: 'Test User',
  });
  mockPrisma.agent.findFirst.mockResolvedValue(mockUnclaimedAgent());
  mockPrisma.agent.update.mockResolvedValue({});
  // Default nation type: open (non-org)
  mockPrisma.nation.findUnique.mockResolvedValue({ type: 'open', displayName: 'MoltPhone' });
  // $transaction mock: execute the callback with a tx proxy that delegates to mockPrisma
  mockPrisma.$transaction.mockImplementation(async (fn: any) => {
    return fn(mockPrisma);
  });
  mockCanCreateAgent.mockResolvedValue({ ok: true });
  mockDeductCredits.mockResolvedValue({ ok: true });
});

// ══════════════════════════════════════════════════════════
// ── POST /api/agents/claim ───────────────────────────────
// ══════════════════════════════════════════════════════════

describe('POST /api/agents/claim', () => {
  it('claims an unclaimed agent successfully', async () => {
    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.agent.id).toBe('agent-unclaimed-1');
    expect(body.agent.moltNumber).toBe('MPHO-XXXX-YYYY-ZZZZ-AAAA');
    expect(body.message).toContain('claimed');
  });

  it('updates agent with ownerId, clears claimToken, enables calling', async () => {
    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    await claimAgent(req);

    const updateCall = mockPrisma.agent.update.mock.calls[0][0];
    expect(updateCall.data.ownerId).toBe(TEST_USER.id);
    expect(updateCall.data.callEnabled).toBe(true);
    expect(updateCall.data.claimToken).toEqual({ set: null });
    expect(updateCall.data.claimExpiresAt).toEqual({ set: null });
    expect(updateCall.data.claimedAt).toBeDefined();
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);

    expect(res.status).toBe(401);
  });

  it('rejects invalid token (agent not found)', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'bad-token-999' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Invalid');
  });

  it('rejects expired claim token (410)', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(
      mockUnclaimedAgent({ claimExpiresAt: pastDate }),
    );

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(410);
    expect(body.error).toContain('expired');
  });

  it('deactivates agent on expired claim', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(
      mockUnclaimedAgent({ claimExpiresAt: pastDate }),
    );

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    await claimAgent(req);

    // Should soft-delete the expired agent
    expect(mockPrisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isActive: false },
      }),
    );
  });

  it('rejects unverified email (403)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: TEST_USER.id,
      emailVerifiedAt: null,
    });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('verify your email');
  });

  it('rejects when Sybil guard fails (quota/cooldown)', async () => {
    mockCanCreateAgent.mockResolvedValue({ ok: false, reason: 'Too many agents' });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Too many agents');
  });

  it('rejects when credit deduction fails (402)', async () => {
    mockDeductCredits.mockResolvedValue({ ok: false });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);

    expect(res.status).toBe(402);
  });

  it('rejects empty claimToken', async () => {
    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: '' },
    });
    const res = await claimAgent(req);

    expect(res.status).toBe(400);
  });

  it('rejects missing body', async () => {
    const req = buildRequest('POST', '/api/agents/claim', { body: {} });
    const res = await claimAgent(req);

    expect(res.status).toBe(400);
  });

  it('sends claim notification email on success', async () => {
    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    expect(res.status).toBe(200);

    // Allow the fire-and-forget promise to resolve
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendClaimEmail).toHaveBeenCalledWith(
      'test@example.com',
      'Unclaimed Bot',
      'MPHO-XXXX-YYYY-ZZZZ-AAAA',
      'MPHO',
      'Test User',
    );
  });

  it('uses $transaction for atomic credit deduction + claim', async () => {
    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    await claimAgent(req);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('keeps callEnabled=false for org nation agents when user is not a member (pending org approval)', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      type: 'org',
      displayName: 'Acme Corp',
      ownerId: 'other-user-id',
      adminUserIds: [],
      memberUserIds: [],
    });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingOrgApproval).toBe(true);
    expect(body.message).toContain('approval');

    // callEnabled should be false for org nations when user is not a member
    const updateCall = mockPrisma.agent.update.mock.calls[0][0];
    expect(updateCall.data.callEnabled).toBe(false);
    expect(updateCall.data.ownerId).toBe(TEST_USER.id);
  });

  it('auto-approves org nation agents when user is nation owner', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      type: 'org',
      displayName: 'My Org',
      ownerId: TEST_USER.id,
      adminUserIds: [],
      memberUserIds: [],
    });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingOrgApproval).toBeUndefined();
    expect(body.message).toContain('can now call out');

    const updateCall = mockPrisma.agent.update.mock.calls[0][0];
    expect(updateCall.data.callEnabled).toBe(true);
  });

  it('auto-approves org nation agents when user is a member', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      type: 'org',
      displayName: 'Member Org',
      ownerId: 'other-owner',
      adminUserIds: [],
      memberUserIds: [TEST_USER.id],
    });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingOrgApproval).toBeUndefined();
    expect(body.message).toContain('can now call out');

    const updateCall = mockPrisma.agent.update.mock.calls[0][0];
    expect(updateCall.data.callEnabled).toBe(true);
  });

  it('auto-approves org nation agents when user is an admin', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      type: 'org',
      displayName: 'Admin Org',
      ownerId: 'other-owner',
      adminUserIds: [TEST_USER.id],
      memberUserIds: [],
    });

    const req = buildRequest('POST', '/api/agents/claim', {
      body: { claimToken: 'valid-claim-token-123' },
    });
    const res = await claimAgent(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.pendingOrgApproval).toBeUndefined();

    const updateCall = mockPrisma.agent.update.mock.calls[0][0];
    expect(updateCall.data.callEnabled).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// ── GET /api/agents/claim/preview ────────────────────────
// ══════════════════════════════════════════════════════════

describe('GET /api/agents/claim/preview', () => {
  it('returns agent info for a valid token', async () => {
    const req = buildRequest('GET', '/api/agents/claim/preview', {
      searchParams: { token: 'valid-claim-token-123' },
    });
    const res = await claimPreview(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agent.id).toBe('agent-unclaimed-1');
    expect(body.agent.moltNumber).toBe('MPHO-XXXX-YYYY-ZZZZ-AAAA');
    expect(body.agent.displayName).toBe('Unclaimed Bot');
    expect(body.agent.nationName).toBe('MoltPhone');
    expect(body.agent.nationBadge).toBe('⚡');
    expect(body.agent.skills).toEqual(['call', 'text']);
  });

  it('rejects missing token parameter', async () => {
    const req = buildRequest('GET', '/api/agents/claim/preview');
    const res = await claimPreview(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 for invalid token', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/agents/claim/preview', {
      searchParams: { token: 'bad-token' },
    });
    const res = await claimPreview(req);

    expect(res.status).toBe(404);
  });

  it('returns 410 for expired claim', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(
      mockUnclaimedAgent({ claimExpiresAt: pastDate }),
    );

    const req = buildRequest('GET', '/api/agents/claim/preview', {
      searchParams: { token: 'valid-claim-token-123' },
    });
    const res = await claimPreview(req);

    expect(res.status).toBe(410);
  });

  it('does not require authentication (public endpoint)', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/agents/claim/preview', {
      searchParams: { token: 'valid-claim-token-123' },
    });
    const res = await claimPreview(req);

    expect(res.status).toBe(200);
  });

  it('does not leak endpointUrl or claimToken', async () => {
    const req = buildRequest('GET', '/api/agents/claim/preview', {
      searchParams: { token: 'valid-claim-token-123' },
    });
    const res = await claimPreview(req);
    const body = await res.json();

    expect(body.agent.endpointUrl).toBeUndefined();
    expect(body.agent.claimToken).toBeUndefined();
    expect(body.agent.publicKey).toBeUndefined();
  });
});
