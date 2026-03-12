/**
 * Integration tests for /api/agents routes.
 *
 * Tests: GET (list), POST (create), GET/:id, PATCH/:id, DELETE/:id
 * Mocks: Prisma client, NextAuth session
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';
import {
  TEST_USER,
  TEST_NATION,
  buildRequest,
  buildMockAgent,
  mockSession,
  resetAgentCounter,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

// Mock Prisma
const mockPrisma = {
  agent: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  nation: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock NextAuth
const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

// Mock SSRF validation (always pass)
jest.mock('@/lib/ssrf', () => ({
  validateWebhookUrl: jest.fn().mockResolvedValue({ ok: true }),
  checkEndpointOwnership: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock endpoint echo challenge (always pass)
jest.mock('@/lib/endpoint-challenge', () => ({
  challengeEndpoint: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock require-https (allow HTTP in tests)
jest.mock('@/lib/require-https', () => ({
  requireHttps: jest.fn().mockReturnValue(null),
}));

// Mock rate-limit (always pass)
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock credits service
jest.mock('@/lib/services/credits', () => ({
  canCreateAgent: jest.fn().mockResolvedValue({ ok: true }),
  deductAgentCreationCredits: jest.fn().mockResolvedValue({ ok: true }),
  checkNationGraduation: jest.fn().mockResolvedValue(false),
  AGENT_CREATION_COST: 100,
}));

// Mock API key auth
jest.mock('@/lib/api-key-auth', () => ({
  authenticateApiKey: jest.fn().mockResolvedValue(null),
}));

// Mock carrier identity
jest.mock('@/lib/carrier-identity', () => ({
  issueRegistrationCertificate: jest.fn().mockReturnValue({
    version: '1',
    moltNumber: 'MOLT-AAAA-BBBB-CCCC-DDDD',
    agentPublicKey: 'mock-public-key',
    nationCode: 'MOLT',
    carrierDomain: 'moltphone.ai',
    issuedAt: 1000000,
    signature: 'mock-sig',
  }),
  registrationCertToJSON: jest.fn().mockReturnValue({
    version: '1',
    molt_number: 'MOLT-AAAA-BBBB-CCCC-DDDD',
    agent_public_key: 'mock-public-key',
    nation_code: 'MOLT',
    carrier_domain: 'moltphone.ai',
    issued_at: 1000000,
    signature: 'mock-sig',
  }),
  getCarrierCertificateJSON: jest.fn().mockReturnValue({
    version: '1',
    carrier_domain: 'moltphone.ai',
    carrier_public_key: 'mock-carrier-pub',
    issued_at: 1000000,
    expires_at: 2000000,
    issuer: 'moltprotocol.org',
    signature: 'mock-carrier-sig',
  }),
}));

// Import routes AFTER mocks
import { GET as listAgents, POST as createAgent } from '../../app/api/agents/route';
import {
  GET as getAgent,
  PATCH as patchAgent,
  DELETE as deleteAgent,
} from '../../app/api/agents/[id]/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockGetServerSession.mockResolvedValue(mockSession());
  // Default: session user exists in DB (with emailVerifiedAt for Sybil guards)
  mockPrisma.user.findUnique.mockResolvedValue({
    id: TEST_USER.id,
    name: TEST_USER.name,
    email: TEST_USER.email,
    emailVerifiedAt: new Date(),
  });
  mockPrisma.agent.count.mockResolvedValue(0);
});

// ── GET /api/agents ──────────────────────────────────────

describe('GET /api/agents', () => {
  it('returns list of agents', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findMany.mockResolvedValue([agent]);
    mockPrisma.agent.count.mockResolvedValue(1);

    const req = buildRequest('GET', '/api/agents');
    const res = await listAgents(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.agents).toHaveLength(1);
    expect(body.agents[0].displayName).toBe(agent.displayName);
    expect(body.total).toBe(1);
  });

  it('strips endpointUrl and publicKey from list response', async () => {
    const agent = buildMockAgent({ endpointUrl: 'https://secret.example.com/webhook' });
    mockPrisma.agent.findMany.mockResolvedValue([agent]);
    mockPrisma.agent.count.mockResolvedValue(1);

    const req = buildRequest('GET', '/api/agents');
    const res = await listAgents(req);
    const body = await res.json();

    expect(body.agents[0].endpointUrl).toBeUndefined();
    expect(body.agents[0].publicKey).toBeUndefined();
  });

  it('filters by search query', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([]);

    const req = buildRequest('GET', '/api/agents', { searchParams: { q: 'solar' } });
    await listAgents(req);

    const call = mockPrisma.agent.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    // Should search displayName, moltNumber, and description
    expect(call.where.OR).toHaveLength(3);
  });

  it('filters by nation code', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([]);

    const req = buildRequest('GET', '/api/agents', { searchParams: { nation: 'MOLT' } });
    await listAgents(req);

    const call = mockPrisma.agent.findMany.mock.calls[0][0];
    expect(call.where.nationCode).toBe('MOLT');
  });

  it('combines search and nation filter', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([]);

    const req = buildRequest('GET', '/api/agents', { searchParams: { q: 'test', nation: 'CLAW' } });
    await listAgents(req);

    const call = mockPrisma.agent.findMany.mock.calls[0][0];
    expect(call.where.nationCode).toBe('CLAW');
    expect(call.where.OR).toBeDefined();
  });

  it('limits results to 50', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([]);
    mockPrisma.agent.count.mockResolvedValue(0);

    const req = buildRequest('GET', '/api/agents');
    await listAgents(req);

    // Default limit is 20, max is 50
    expect(mockPrisma.agent.findMany.mock.calls[0][0].take).toBe(20);
  });
});

// ── POST /api/agents ─────────────────────────────────────

describe('POST /api/agents', () => {
  it('creates agent with self-certifying MoltNumber', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(TEST_NATION);
    mockPrisma.agent.findUnique.mockResolvedValue(null); // no collision
    mockPrisma.agent.create.mockImplementation(async ({ data }: any) => ({
      ...data,
      id: 'new-agent-id',
      nation: { code: 'MOLT', displayName: 'MoltPhone', badge: '⚡' },
      owner: { id: TEST_USER.id, name: 'Test User' },
    }));

    const req = buildRequest('POST', '/api/agents', {
      body: {
        nationCode: 'MOLT',
        displayName: 'My Agent',
        description: 'A test agent',
      },
    });
    const res = await createAgent(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.displayName).toBe('My Agent');
    expect(body.privateKey).toBeDefined(); // MoltSIM private key shown once
    expect(body.endpointUrl).toBeUndefined(); // stripped from response
    expect(body.publicKey).toBeUndefined(); // stripped from response

    // Verify the created agent has a valid self-certifying MoltNumber
    const createCall = mockPrisma.agent.create.mock.calls[0][0];
    expect(createCall.data.moltNumber).toMatch(/^MOLT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(createCall.data.publicKey).toBeDefined();
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(401);
  });

  it('rejects invalid nation code', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'FAKE', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(404);
  });

  it('rejects restricted nation for non-owner', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, isPublic: false, ownerId: 'other-user' });

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(403);
  });

  it('rejects carrier nation for non-owner', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, type: 'carrier', isPublic: true, ownerId: 'other-user' });

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.error).toContain('Carrier');
  });

  it('rejects org nation for non-owner without delegation', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, type: 'org', isPublic: true, ownerId: 'other-user' });

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    const body = await res.json();
    expect(res.status).toBe(403);
    // Org nations require a delegation certificate when accessed by non-owners
    expect(body.error).toContain('delegation');
  });

  it('allows carrier nation for owner', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, type: 'carrier', isPublic: true });
    mockPrisma.agent.findUnique.mockResolvedValue(null);
    mockPrisma.agent.create.mockResolvedValue(buildMockAgent());

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(201);
  });

  it('returns 409 on MoltNumber collision', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(TEST_NATION);
    mockPrisma.agent.findUnique.mockResolvedValue({ id: 'existing' }); // collision!

    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT', displayName: 'Agent' },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(409);
  });

  it('validates request body with Zod', async () => {
    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'MOLT' }, // missing displayName
    });
    const res = await createAgent(req);
    expect(res.status).toBe(400);
  });

  it('validates endpoint URL via SSRF check', async () => {
    const { validateWebhookUrl } = require('@/lib/ssrf');
    validateWebhookUrl.mockResolvedValueOnce({ ok: false, reason: 'Private IP' });
    mockPrisma.nation.findUnique.mockResolvedValue(TEST_NATION);

    const req = buildRequest('POST', '/api/agents', {
      body: {
        nationCode: 'MOLT',
        displayName: 'Agent',
        endpointUrl: 'http://127.0.0.1:8080',
      },
    });
    const res = await createAgent(req);
    expect(res.status).toBe(400);
  });

  it('rejects invalid nation code format', async () => {
    const req = buildRequest('POST', '/api/agents', {
      body: { nationCode: 'mol', displayName: 'Agent' }, // lowercase
    });
    const res = await createAgent(req);
    expect(res.status).toBe(400);
  });
});

// ── GET /api/agents/:id ──────────────────────────────────

describe('GET /api/agents/:id', () => {
  it('returns agent MoltPage (public view)', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/api/agents/${agent.id}`);
    const res = await getAgent(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.displayName).toBe(agent.displayName);
    expect(body.online).toBe(false); // lastSeenAt is null
    // Sensitive fields stripped
    expect(body.endpointUrl).toBeUndefined();
    expect(body.publicKey).toBeUndefined();
    expect(body.allowlistAgentIds).toBeUndefined();
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/agents/nonexistent');
    const res = await getAgent(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });

  it('shows online=true when recently seen', async () => {
    const agent = buildMockAgent({ lastSeenAt: new Date() });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/api/agents/${agent.id}`);
    const res = await getAgent(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(body.online).toBe(true);
  });
});

// ── PATCH /api/agents/:id ────────────────────────────────

describe('PATCH /api/agents/:id', () => {
  it('updates agent settings', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.update.mockResolvedValue({ ...agent, displayName: 'Updated Name' });

    const req = buildRequest('PATCH', `/api/agents/${agent.id}`, {
      body: { displayName: 'Updated Name' },
    });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.displayName).toBe('Updated Name');
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('PATCH', '/api/agents/some-id', {
      body: { displayName: 'X' },
    });
    const res = await patchAgent(req, { params: Promise.resolve({ id: 'some-id' }) });
    expect(res.status).toBe(401);
  });

  it('rejects updates from non-owner', async () => {
    const agent = buildMockAgent({ ownerId: 'other-user-id' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('PATCH', `/api/agents/${agent.id}`, {
      body: { displayName: 'Hacked' },
    });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(403);
  });

  it('rejects unknown fields (strict schema)', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('PATCH', `/api/agents/${agent.id}`, {
      body: { moltNumber: 'HACK-1234-5678-9012-3456' }, // not in patch schema
    });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });

  it('validates endpoint URL via SSRF', async () => {
    const { validateWebhookUrl } = require('@/lib/ssrf');
    validateWebhookUrl.mockResolvedValueOnce({ ok: false, reason: 'Private IP' });
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('PATCH', `/api/agents/${agent.id}`, {
      body: { endpointUrl: 'http://10.0.0.1:8080' },
    });
    const res = await patchAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(400);
  });
});

// ── DELETE /api/agents/:id ───────────────────────────────

describe('DELETE /api/agents/:id', () => {
  it('soft-deletes agent', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.update.mockResolvedValue({ ...agent, isActive: false });

    const req = buildRequest('DELETE', `/api/agents/${agent.id}`);
    const res = await deleteAgent(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockPrisma.agent.update).toHaveBeenCalledWith({
      where: { id: agent.id },
      data: { isActive: false, publicKey: '' },
    });
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('DELETE', '/api/agents/some-id');
    const res = await deleteAgent(req, { params: Promise.resolve({ id: 'some-id' }) });
    expect(res.status).toBe(401);
  });

  it('rejects deletion by non-owner', async () => {
    const agent = buildMockAgent({ ownerId: 'other-user-id' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('DELETE', `/api/agents/${agent.id}`);
    const res = await deleteAgent(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('DELETE', '/api/agents/nonexistent');
    const res = await deleteAgent(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });
});
