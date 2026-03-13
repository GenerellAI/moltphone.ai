/**
 * Integration tests for GET /call/:moltNumber/agent.json (Agent Card)
 *
 * Tests: public access, non-public access control, Agent Card shape,
 * x-molt extensions, status, skills, authentication scheme.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildSignedRequest, buildMockAgent, buildRequest, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

jest.mock('@/lib/presence', () => ({
  isOnline: jest.fn().mockReturnValue(false),
}));

jest.mock('@/lib/carrier-identity', () => ({
  getCarrierPublicKey: jest.fn().mockReturnValue('mock-carrier-pubkey'),
  issueRegistrationCertificate: jest.fn().mockReturnValue({
    version: '1',
    moltNumber: 'MOCK',
    agentPublicKey: 'mock',
    nationCode: 'MPHO',
    carrierDomain: 'moltphone.ai',
    issuedAt: 1234567890,
    signature: 'mock-sig',
  }),
  registrationCertToJSON: jest.fn().mockImplementation((cert: Record<string, unknown>) => ({
    version: cert.version ?? '1',
    molt_number: cert.moltNumber ?? 'MOCK',
    agent_public_key: cert.agentPublicKey ?? 'mock',
    nation_code: cert.nationCode ?? 'MPHO',
    carrier_domain: cert.carrierDomain ?? 'moltphone.ai',
    issued_at: cert.issuedAt ?? 1234567890,
    signature: cert.signature ?? 'mock-sig',
  })),
  CARRIER_DOMAIN: 'moltphone.ai',
}));

jest.mock('@/lib/call-url', () => ({
  callUrl: jest.fn((num: string, path: string) => `http://localhost:3000/call/${num}${path}`),
}));

import { GET as getAgentCard } from '../../app/call/[moltNumber]/agent.json/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
  mockPrisma.nonceUsed.create.mockResolvedValue({});
});

// ── Public agent ─────────────────────────────────────────

describe('GET /call/:moltNumber/agent.json — public', () => {
  it('returns Agent Card for public agent without auth', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe(agent.displayName);
    expect(body.url).toContain('/tasks/send');
  });

  it('includes x-molt extensions', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body['x-molt']).toBeDefined();
    expect(body['x-molt'].molt_number).toBe(agent.moltNumber);
    expect(body['x-molt'].nation).toBe('MPHO');
    expect(body['x-molt'].nation_type).toBe('carrier');
    expect(body['x-molt'].public_key).toBe(agent.publicKey);
    expect(body['x-molt'].inbound_policy).toBe('public');
    expect(body['x-molt'].timestamp_window_seconds).toBe(300);
  });

  it('shows offline status when agent not recently seen', async () => {
    const agent = buildMockAgent({ lastSeenAt: null });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.status).toBe('offline');
  });

  it('shows online status when recently seen', async () => {
    const { isOnline } = require('@/lib/presence');
    isOnline.mockReturnValueOnce(true);

    const agent = buildMockAgent({ lastSeenAt: new Date() });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.status).toBe('online');
  });

  it('includes skills from agent config', async () => {
    const agent = buildMockAgent({ skills: ['call', 'text', 'code-review'] });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.skills).toHaveLength(3);
    expect(body.skills.map((s: any) => s.id)).toEqual(['call', 'text', 'code-review']);
  });

  it('marks authentication as not required for public agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.authentication.required).toBe(false);
  });

  it('includes registration certificate', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body['x-molt'].registration_certificate).toBeDefined();
    expect(body['x-molt'].registration_certificate.version).toBe('1');
  });

  it('includes provider block', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.provider.organization).toBe('MoltPhone');
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('GET', '/call/MPHO-XXXX-YYYY-ZZZZ-AAAA/agent.json');
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: 'MPHO-XXXX-YYYY-ZZZZ-AAAA' }) });

    expect(res.status).toBe(404);
  });

  it('never exposes endpointUrl', async () => {
    const agent = buildMockAgent({
      inboundPolicy: 'public',
      endpointUrl: 'https://secret.example.com/webhook',
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(json).not.toContain('secret.example.com');
    expect(json).not.toContain('endpointUrl');
  });
});

// ── Non-public agents ────────────────────────────────────

describe('GET /call/:moltNumber/agent.json — non-public', () => {
  it('requires auth for registered_only agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'registered_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('allows authenticated access to registered_only agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'registered_only' });
    const caller = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);

    const req = buildSignedRequest(
      'GET',
      `/call/${agent.moltNumber}/agent.json`,
      caller,
      { targetMoltNumber: agent.moltNumber },
    );
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(200);
  });

  it('requires auth for allowlist agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'allowlist' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/agent.json`);
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('rejects non-allowlisted caller for allowlist agents', async () => {
    const caller = buildMockAgent();
    const agent = buildMockAgent({ inboundPolicy: 'allowlist', allowlistAgentIds: ['other-id'] });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);

    const req = buildSignedRequest(
      'GET',
      `/call/${agent.moltNumber}/agent.json`,
      caller,
      { targetMoltNumber: agent.moltNumber },
    );
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('allows allowlisted caller', async () => {
    const caller = buildMockAgent();
    const agent = buildMockAgent({ inboundPolicy: 'allowlist', allowlistAgentIds: [caller.id] });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);

    const req = buildSignedRequest(
      'GET',
      `/call/${agent.moltNumber}/agent.json`,
      caller,
      { targetMoltNumber: agent.moltNumber },
    );
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(200);
  });

  it('marks authentication as required for non-public agents', async () => {
    const caller = buildMockAgent();
    const agent = buildMockAgent({ inboundPolicy: 'registered_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);

    const req = buildSignedRequest(
      'GET',
      `/call/${agent.moltNumber}/agent.json`,
      caller,
      { targetMoltNumber: agent.moltNumber },
    );
    const res = await getAgentCard(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.authentication.required).toBe(true);
  });
});
