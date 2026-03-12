/**
 * Integration tests for direct connection API routes.
 *
 * POST/GET /api/agents/:id/direct-connections     — propose & list
 * PATCH   /api/agents/:id/direct-connections/:cid — accept/reject/revoke
 * POST    /api/direct-connections/verify-token     — verify upgrade token
 *
 * Auth, ownership, validation, and service delegation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  TEST_USER,
  buildRequest,
  buildMockAgent,
  mockSession,
  resetAgentCounter,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: { findUnique: jest.fn() },
  nonceUsed: { findUnique: jest.fn(), create: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// Mock the direct connections service
const mockPropose = jest.fn();
const mockMaybeAutoAccept = jest.fn();
const mockList = jest.fn();
const mockAccept = jest.fn();
const mockReject = jest.fn();
const mockRevoke = jest.fn();
const mockVerifyToken = jest.fn();

jest.mock('@/lib/services/direct-connections', () => ({
  proposeDirectConnection: (...args: any[]) => mockPropose(...args),
  maybeAutoAccept: (...args: any[]) => mockMaybeAutoAccept(...args),
  listDirectConnections: (...args: any[]) => mockList(...args),
  acceptDirectConnection: (...args: any[]) => mockAccept(...args),
  rejectDirectConnection: (...args: any[]) => mockReject(...args),
  revokeDirectConnection: (...args: any[]) => mockRevoke(...args),
  verifyAndConsumeUpgradeToken: (...args: any[]) => mockVerifyToken(...args),
  PROPOSAL_TTL_MS: 86_400_000,
  ACTIVE_STATUSES: ['proposed', 'accepted', 'active'],
}));

// ── Import routes ────────────────────────────────────────

import { POST as propose, GET as list } from '../../app/api/agents/[id]/direct-connections/route';
import { PATCH as patchConnection } from '../../app/api/agents/[id]/direct-connections/[connectionId]/route';
import { POST as verifyToken } from '../../app/api/direct-connections/verify-token/route';

// ── Setup ────────────────────────────────────────────────

let agent: ReturnType<typeof buildMockAgent>;

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  agent = buildMockAgent();
  mockGetServerSession.mockResolvedValue(mockSession());
  mockPrisma.agent.findUnique.mockResolvedValue(agent);
  mockMaybeAutoAccept.mockResolvedValue(null); // No auto-accept by default
});

// ══════════════════════════════════════════════════════════
// ── POST /api/agents/:id/direct-connections (propose) ────
// ══════════════════════════════════════════════════════════

describe('POST /api/agents/:id/direct-connections', () => {
  it('proposes a direct connection', async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    mockPropose.mockResolvedValue({ ok: true, connectionId: 'conn-1', expiresAt });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.connectionId).toBe('conn-1');
    expect(body.status).toBe('proposed');
    expect(body.expiresAt).toBeDefined();
  });

  it('handles auto-accept (direct_on_accept policy)', async () => {
    mockPropose.mockResolvedValue({ ok: true, connectionId: 'conn-1', expiresAt: new Date() });
    mockMaybeAutoAccept.mockResolvedValue({
      connectionId: 'conn-1',
      proposerEndpoint: 'https://proposer.example.com',
      targetEndpoint: 'https://target.example.com',
      upgradeToken: 'auto-token-abc',
      targetPublicKey: 'target-pub-key',
    });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.status).toBe('accepted');
    expect(body.autoAccepted).toBe(true);
    expect(body.upgradeToken).toBe('auto-token-abc');
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(401);
  });

  it('rejects non-owner', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({ ...agent, ownerId: 'other-user' });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(404);
  });

  it('returns service error when proposal fails', async () => {
    mockPropose.mockResolvedValue({ ok: false, code: 'policy_denied', reason: 'Target blocks direct connections' });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(403);
  });

  it('rejects self-connection (from service)', async () => {
    mockPropose.mockResolvedValue({ ok: false, code: 'self_connection', reason: 'Cannot connect to self' });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: agent.id },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
  });

  it('rejects duplicate (already_exists)', async () => {
    mockPropose.mockResolvedValue({ ok: false, code: 'already_exists', reason: 'Connection already exists' });

    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: { targetAgentId: 'target-agent-id' },
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(409);
  });

  it('rejects missing targetAgentId', async () => {
    const req = buildRequest('POST', `/api/agents/${agent.id}/direct-connections`, {
      body: {},
    });
    const res = await propose(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(400);
  });
});

// ══════════════════════════════════════════════════════════
// ── GET /api/agents/:id/direct-connections (list) ────────
// ══════════════════════════════════════════════════════════

describe('GET /api/agents/:id/direct-connections', () => {
  it('lists connections for the agent', async () => {
    mockList.mockResolvedValue([
      {
        id: 'conn-1',
        proposerAgent: { id: agent.id, displayName: 'Agent 1' },
        targetAgent: { id: 'target-1', displayName: 'Target 1' },
        status: 'proposed',
        proposedAt: new Date(),
        acceptedAt: null,
        activatedAt: null,
      },
    ]);

    const req = buildRequest('GET', `/api/agents/${agent.id}/direct-connections`);
    const res = await list(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    // Route returns a plain array, not { connections: [...] }
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('conn-1');
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('GET', `/api/agents/${agent.id}/direct-connections`);
    const res = await list(req, { params: Promise.resolve({ id: agent.id }) });

    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════
// ── PATCH (accept / reject / revoke) ─────────────────────
// ══════════════════════════════════════════════════════════

describe('PATCH /api/agents/:id/direct-connections/:connectionId', () => {
  const connParams = Promise.resolve({ id: 'agent-1', connectionId: 'conn-1' });

  it('accepts a connection', async () => {
    mockAccept.mockResolvedValue({
      ok: true,
      proposerEndpoint: 'https://proposer.example.com',
      proposerPublicKey: 'prop-pub-key',
      upgradeToken: 'token-xyz',
    });

    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'accept' },
    });
    const res = await patchConnection(req, { params: connParams });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('accepted');
    expect(body.upgradeToken).toBe('token-xyz');
    expect(body.peerEndpoint).toBe('https://proposer.example.com');
  });

  it('rejects a connection', async () => {
    mockReject.mockResolvedValue({ ok: true });

    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'reject' },
    });
    const res = await patchConnection(req, { params: connParams });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('rejected');
  });

  it('revokes a connection', async () => {
    mockRevoke.mockResolvedValue({ ok: true });

    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'revoke' },
    });
    const res = await patchConnection(req, { params: connParams });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('revoked');
  });

  it('rejects invalid action', async () => {
    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'invalid' },
    });
    const res = await patchConnection(req, { params: connParams });

    expect(res.status).toBe(400);
  });

  it('propagates service errors on accept failure', async () => {
    mockAccept.mockResolvedValue({ ok: false, code: 'invalid_state', reason: 'Already accepted' });

    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'accept' },
    });
    const res = await patchConnection(req, { params: connParams });

    expect(res.status).toBe(409);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('PATCH', `/api/agents/agent-1/direct-connections/conn-1`, {
      body: { action: 'accept' },
    });
    const res = await patchConnection(req, { params: connParams });

    expect(res.status).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════
// ── POST /api/direct-connections/verify-token ────────────
// ══════════════════════════════════════════════════════════

describe('POST /api/direct-connections/verify-token', () => {
  it('verifies a valid upgrade token', async () => {
    mockVerifyToken.mockResolvedValue({
      ok: true,
      connectionId: 'conn-1',
      proposerAgentId: 'agent-a',
      targetAgentId: 'agent-b',
    });

    const req = buildRequest('POST', '/api/direct-connections/verify-token', {
      body: { upgradeToken: 'valid-token' },
    });
    const res = await verifyToken(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.connectionId).toBe('conn-1');
    expect(body.proposerAgentId).toBe('agent-a');
    expect(body.targetAgentId).toBe('agent-b');
  });

  it('rejects invalid token', async () => {
    mockVerifyToken.mockResolvedValue({ ok: false, reason: 'Token not found or expired' });

    const req = buildRequest('POST', '/api/direct-connections/verify-token', {
      body: { upgradeToken: 'bad-token' },
    });
    const res = await verifyToken(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.valid).toBe(false);
  });

  it('rejects missing upgradeToken', async () => {
    const req = buildRequest('POST', '/api/direct-connections/verify-token', {
      body: {},
    });
    const res = await verifyToken(req);

    expect(res.status).toBe(400);
  });

  it('rejects empty upgradeToken', async () => {
    const req = buildRequest('POST', '/api/direct-connections/verify-token', {
      body: { upgradeToken: '' },
    });
    const res = await verifyToken(req);

    expect(res.status).toBe(400);
  });
});
