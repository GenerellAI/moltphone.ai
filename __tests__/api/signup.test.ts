/**
 * Integration tests for /api/agents/signup (agent self-signup).
 *
 * Tests: POST (self-signup without auth), validation, rate limiting,
 * nation checks, SSRF, collision handling, response shape.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  TEST_NATION,
  buildRequest,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  nation: { findUnique: jest.fn() },
  agent: { findUnique: jest.fn(), create: jest.fn() },
  nonceUsed: { findUnique: jest.fn(), create: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock NextAuth (signup doesn't need auth but the module may be imported)
jest.mock('next-auth', () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));

// Mock SSRF (always pass)
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

// Mock rate-limit (default: pass)
const mockRateLimit = jest.fn().mockResolvedValue({ ok: true });
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: any[]) => mockRateLimit(...args),
}));

// Mock ed25519 — return predictable keypair
jest.mock('@/lib/ed25519', () => ({
  generateKeyPair: jest.fn().mockReturnValue({
    publicKey: 'mock-public-key-base64',
    privateKey: 'mock-private-key-base64',
  }),
  signRequest: jest.fn(),
  verifySignature: jest.fn(),
}));

// Mock molt-number
jest.mock('@/lib/molt-number', () => ({
  generateMoltNumber: jest.fn().mockReturnValue('MOLT-AAAA-BBBB-CCCC-DDDD'),
}));

// Mock secrets
jest.mock('@/lib/secrets', () => ({
  generateSecret: jest.fn().mockReturnValue('mock-claim-token-abc123'),
}));

// Mock carrier identity
jest.mock('@/lib/carrier-identity', () => ({
  issueRegistrationCertificate: jest.fn().mockReturnValue({
    version: '1',
    moltNumber: 'MOLT-AAAA-BBBB-CCCC-DDDD',
    agentPublicKey: 'mock-public-key-base64',
    nationCode: 'MOLT',
    carrierDomain: 'moltphone.ai',
    issuedAt: 1234567890,
    signature: 'mock-cert-sig',
  }),
  registrationCertToJSON: jest.fn().mockReturnValue({
    version: '1',
    molt_number: 'MOLT-AAAA-BBBB-CCCC-DDDD',
    agent_public_key: 'mock-public-key-base64',
    nation_code: 'MOLT',
    carrier_domain: 'moltphone.ai',
    issued_at: 1234567890,
    signature: 'mock-cert-sig',
  }),
  getCarrierCertificateJSON: jest.fn().mockReturnValue({
    version: '1',
    carrier_domain: 'moltphone.ai',
    carrier_public_key: 'mock-carrier-pub',
    issued_at: 1234567890,
    expires_at: 9999999999,
    issuer: 'moltprotocol.org',
    signature: 'mock-carrier-cert-sig',
  }),
  getCarrierPublicKey: jest.fn().mockReturnValue('mock-carrier-pub'),
  CARRIER_DOMAIN: 'moltphone.ai',
}));

// Mock credits service
jest.mock('@/lib/services/credits', () => ({
  checkNationGraduation: jest.fn().mockResolvedValue(false),
}));

// Mock call-url
jest.mock('@/lib/call-url', () => ({
  CALL_BASE_URL: 'http://call.localhost:3000',
  callUrl: jest.fn((phone: string, path: string) => `http://call.localhost:3000/call/${phone}${path}`),
}));

// ── Import route ─────────────────────────────────────────

import { POST as signup } from '../../app/api/agents/signup/route';

// ── Setup ────────────────────────────────────────────────

const VALID_BODY = {
  nationCode: 'MOLT',
  displayName: 'My Autonomous Agent',
  description: 'A test agent',
  endpointUrl: 'https://example.com/webhook',
  inboundPolicy: 'public',
  skills: ['call', 'text'],
};

const mockCreatedAgent = {
  id: 'agent-new-1',
  moltNumber: 'MOLT-AAAA-BBBB-CCCC-DDDD',
  nationCode: 'MOLT',
  displayName: 'My Autonomous Agent',
  description: 'A test agent',
  skills: ['call', 'text'],
  claimExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  nation: { code: 'MOLT', displayName: 'MoltPhone', badge: '⚡' },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, isPublic: true });
  mockPrisma.agent.findUnique.mockResolvedValue(null); // no collision
  mockPrisma.agent.create.mockResolvedValue(mockCreatedAgent);
  mockRateLimit.mockReturnValue({ ok: true });
  // Reset SSRF mock (may be overridden in individual tests)
  const { validateWebhookUrl } = require('@/lib/ssrf');
  validateWebhookUrl.mockResolvedValue({ ok: true });
});

// ── Tests ────────────────────────────────────────────────

describe('POST /api/agents/signup', () => {
  it('creates an unclaimed agent and returns MoltSIM + claim link', async () => {
    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(201);

    // Agent response
    expect(body.agent.id).toBe('agent-new-1');
    expect(body.agent.moltNumber).toBe('MOLT-AAAA-BBBB-CCCC-DDDD');
    expect(body.agent.status).toBe('unclaimed');
    expect(body.agent.claimExpiresAt).toBeDefined();

    // MoltSIM
    expect(body.moltsim).toBeDefined();
    expect(body.moltsim.version).toBe('1');
    expect(body.moltsim.carrier).toBe('moltphone.ai');
    expect(body.moltsim.molt_number).toBe('MOLT-AAAA-BBBB-CCCC-DDDD');
    expect(body.moltsim.private_key).toBe('mock-private-key-base64');
    expect(body.moltsim.public_key).toBe('mock-public-key-base64');
    expect(body.moltsim.carrier_public_key).toBe('mock-carrier-pub');
    expect(body.moltsim.signature_algorithm).toBe('Ed25519');
    expect(body.moltsim.timestamp_window_seconds).toBe(300);
    expect(body.moltsim.nation_type).toBe('open');

    // Claim info
    expect(body.claim).toBeDefined();
    expect(body.claim.url).toContain('/claim/mock-claim-token-abc123');
    expect(body.claim.expiresAt).toBeDefined();
    expect(body.claim.instructions).toBeDefined();

    // Registration certificate
    expect(body.registrationCertificate).toBeDefined();
    expect(body.registrationCertificate.version).toBe('1');
  });

  it('creates agent with callEnabled=false (unclaimed)', async () => {
    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    await signup(req);

    const createCall = mockPrisma.agent.create.mock.calls[0][0];
    expect(createCall.data.callEnabled).toBe(false);
    expect(createCall.data.ownerId).toBeUndefined();
    expect(createCall.data.claimToken).toBe('mock-claim-token-abc123');
  });

  it('defaults inboundPolicy to public and skills to [call, text]', async () => {
    const req = buildRequest('POST', '/api/agents/signup', {
      body: { nationCode: 'MOLT', displayName: 'Minimal Agent' },
    });
    await signup(req);

    const createCall = mockPrisma.agent.create.mock.calls[0][0];
    expect(createCall.data.inboundPolicy).toBe('public');
    expect(createCall.data.skills).toEqual(['call', 'text']);
  });

  it('rejects missing nationCode', async () => {
    const req = buildRequest('POST', '/api/agents/signup', {
      body: { displayName: 'No Nation' },
    });
    const res = await signup(req);
    expect(res.status).toBe(400);
  });

  it('rejects missing displayName', async () => {
    const req = buildRequest('POST', '/api/agents/signup', {
      body: { nationCode: 'MOLT' },
    });
    const res = await signup(req);
    expect(res.status).toBe(400);
  });

  it('rejects invalid nationCode format', async () => {
    const req = buildRequest('POST', '/api/agents/signup', {
      body: { nationCode: 'ab', displayName: 'Bad Nation' },
    });
    const res = await signup(req);
    expect(res.status).toBe(400);
  });

  it('rejects non-existent nation', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toContain('Nation not found');
  });

  it('rejects private (non-public) nation', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, isPublic: false });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('restricted');
  });

  it('rejects carrier nation for self-signup', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, type: 'carrier', isPublic: true });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('Carrier');
  });

  it('rejects org nation self-signup when memberUserIds is set', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({
      ...TEST_NATION,
      type: 'org',
      isPublic: true,
      memberUserIds: ['some-user-id'],
    });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toContain('member');
  });

  it('rejects private carrier nation for self-signup', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue({ ...TEST_NATION, type: 'carrier', isPublic: false });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);

    expect(res.status).toBe(403);
  });

  it('enforces rate limiting (3/hour per IP)', async () => {
    mockRateLimit.mockReturnValue({ ok: false });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);

    expect(res.status).toBe(429);
  });

  it('handles MoltNumber collision (409)', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({ id: 'existing-agent' });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('collision');
  });

  it('validates endpointUrl via SSRF check', async () => {
    const { validateWebhookUrl } = require('@/lib/ssrf');
    validateWebhookUrl.mockResolvedValue({ ok: false, reason: 'private IP blocked' });

    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('Invalid endpoint URL');
  });

  it('allows signup without endpointUrl', async () => {
    const req = buildRequest('POST', '/api/agents/signup', {
      body: { nationCode: 'MOLT', displayName: 'No Webhook' },
    });
    const res = await signup(req);

    expect(res.status).toBe(201);
  });

  it('claim expiry is ~7 days in the future', async () => {
    const req = buildRequest('POST', '/api/agents/signup', { body: VALID_BODY });
    const res = await signup(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    // The claim section has the expiry date
    expect(body.claim).toBeDefined();
    expect(body.claim.expiresAt).toBeDefined();

    const expiresAt = new Date(body.claim.expiresAt).getTime();
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Should be between 6.9 and 7.1 days from now
    expect(expiresAt - now).toBeGreaterThan(sevenDaysMs - 60_000);
    expect(expiresAt - now).toBeLessThan(sevenDaysMs + 60_000);
  });
});
