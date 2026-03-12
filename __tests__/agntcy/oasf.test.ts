/**
 * Tests for OASF (Open Agentic Schema Framework) export.
 *
 * Tests the pure mapper module (lib/agntcy/oasf.ts) and the endpoint
 * (GET /call/:moltNumber/oasf.json).
 *
 * Acceptance criteria from agntcy-quick-wins-plan.md:
 *   - Deterministic export from Agent Card input
 *   - No secret leakage (endpointUrl never exposed)
 *   - Molt-specific semantics preserved in x-molt module
 *   - Stable output shape
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { agentCardToOASF, type AgentCardInput, type OASFRecord } from '../../lib/agntcy/oasf';
import { buildMockAgent, buildRequest, buildSignedRequest, resetAgentCounter } from '../helpers/setup';

// ── 1. Pure mapper tests ─────────────────────────────────

describe('agentCardToOASF — pure mapper', () => {
  const baseCard: AgentCardInput = {
    schema: 'https://moltprotocol.org/a2a/agent-card/v1',
    name: 'Solar Inspector',
    description: 'An autonomous solar panel inspector',
    url: 'https://moltphone.ai/call/SOLR-12AB-C3D4-EF56/tasks/send',
    provider: { organization: 'MoltPhone', url: 'https://moltphone.ai' },
    version: '1.0',
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: [
      { id: 'call', name: 'call' },
      { id: 'text', name: 'text' },
    ],
    authentication: { schemes: ['Ed25519'], required: false },
    status: 'online',
    'x-molt': {
      molt_number: 'SOLR-12AB-C3D4-EF56',
      nation: 'SOLR',
      nation_type: 'open',
      public_key: 'abc123pubkey',
      inbound_policy: 'public',
      direct_connection_policy: 'direct_on_consent',
      timestamp_window_seconds: 300,
      carrier_certificate_url: 'https://moltphone.ai/.well-known/molt-carrier.json',
    },
  };

  it('produces a valid OASF record from an Agent Card', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.oasf_schema).toBe('1.0.0');
    expect(record.name).toBe('Solar Inspector');
    expect(record.description).toBe('An autonomous solar panel inspector');
    expect(record.version).toBe('1.0');
    expect(record.agent_ref).toBe('SOLR-12AB-C3D4-EF56');
  });

  it('is deterministic — same input produces same output', () => {
    const a = agentCardToOASF(baseCard);
    const b = agentCardToOASF(baseCard);

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('preserves source schema reference', () => {
    const record = agentCardToOASF(baseCard);
    expect(record.source_schema).toBe('https://moltprotocol.org/a2a/agent-card/v1');
  });

  it('generates correct locators from task/send URL', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.locators).toHaveLength(2);
    expect(record.locators[0]).toEqual({
      type: 'a2a',
      url: 'https://moltphone.ai/call/SOLR-12AB-C3D4-EF56/tasks/send',
    });
    expect(record.locators[1]).toEqual({
      type: 'agent-card',
      url: 'https://moltphone.ai/call/SOLR-12AB-C3D4-EF56/agent.json',
    });
  });

  it('maps skills with descriptions for known types', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.skills).toHaveLength(2);
    expect(record.skills[0]).toEqual({
      id: 'call',
      name: 'call',
      description: 'Multi-turn conversation (streaming)',
    });
    expect(record.skills[1]).toEqual({
      id: 'text',
      name: 'text',
      description: 'Fire-and-forget message (single task)',
    });
  });

  it('preserves custom skills without default descriptions', () => {
    const card: AgentCardInput = {
      ...baseCard,
      skills: [
        { id: 'call', name: 'call' },
        { id: 'code-review', name: 'code-review' },
      ],
    };
    const record = agentCardToOASF(card);

    expect(record.skills[1]).toEqual({
      id: 'code-review',
      name: 'code-review',
      description: undefined,
    });
  });

  it('maps capabilities correctly', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.capabilities).toEqual({
      streaming: false,
      push_notifications: false,
      state_transition_history: true,
      input_modes: ['text'],
      output_modes: ['text'],
    });
  });

  it('maps authentication', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.authentication).toEqual({
      schemes: ['Ed25519'],
      required: false,
    });
  });

  it('maps provider', () => {
    const record = agentCardToOASF(baseCard);

    expect(record.provider).toEqual({
      organization: 'MoltPhone',
      url: 'https://moltphone.ai',
    });
  });

  it('includes online/offline status', () => {
    const online = agentCardToOASF({ ...baseCard, status: 'online' });
    expect(online.status).toBe('online');

    const offline = agentCardToOASF({ ...baseCard, status: 'offline' });
    expect(offline.status).toBe('offline');
  });

  it('includes degraded flag when set', () => {
    const normal = agentCardToOASF(baseCard);
    expect(normal.degraded).toBeUndefined();

    const degraded = agentCardToOASF({ ...baseCard, degraded: true });
    expect(degraded.degraded).toBe(true);
  });

  // ── x-molt module ────────────────────────────────────

  it('preserves Molt-specific data in x-molt module', () => {
    const record = agentCardToOASF(baseCard);
    const xMolt = record.modules['x-molt'];

    expect(xMolt.molt_number).toBe('SOLR-12AB-C3D4-EF56');
    expect(xMolt.nation).toBe('SOLR');
    expect(xMolt.nation_type).toBe('open');
    expect(xMolt.public_key).toBe('abc123pubkey');
    expect(xMolt.inbound_policy).toBe('public');
    expect(xMolt.direct_connection_policy).toBe('direct_on_consent');
    expect(xMolt.timestamp_window_seconds).toBe(300);
  });

  it('includes carrier_certificate_url when present', () => {
    const record = agentCardToOASF(baseCard);
    expect(record.modules['x-molt'].carrier_certificate_url).toBe(
      'https://moltphone.ai/.well-known/molt-carrier.json',
    );
  });

  it('includes registration certificate when present', () => {
    const card: AgentCardInput = {
      ...baseCard,
      'x-molt': {
        ...baseCard['x-molt'],
        registration_certificate: {
          version: '1',
          molt_number: 'SOLR-12AB-C3D4-EF56',
          agent_public_key: 'abc123',
          nation_code: 'SOLR',
          carrier_domain: 'moltphone.ai',
          issued_at: 1719936000,
          signature: 'sig123',
        },
      },
    };
    const record = agentCardToOASF(card);
    expect(record.modules['x-molt'].registration_certificate).toBeDefined();
    expect(record.modules['x-molt'].registration_certificate?.version).toBe('1');
  });

  it('includes lexicon_url when present', () => {
    const card: AgentCardInput = {
      ...baseCard,
      'x-molt': {
        ...baseCard['x-molt'],
        lexicon_url: 'https://moltphone.ai/call/SOLR-12AB-C3D4-EF56/lexicon',
      },
    };
    const record = agentCardToOASF(card);
    expect(record.modules['x-molt'].lexicon_url).toBe(
      'https://moltphone.ai/call/SOLR-12AB-C3D4-EF56/lexicon',
    );
  });

  // ── Security ──────────────────────────────────────────

  it('never includes endpointUrl in the output', () => {
    const record = agentCardToOASF(baseCard);
    const json = JSON.stringify(record);

    // endpointUrl should never appear anywhere in the export
    expect(json).not.toContain('endpointUrl');
    expect(json).not.toContain('endpoint_url');
    expect(json).not.toContain('webhookUrl');
    expect(json).not.toContain('webhook_url');
  });

  it('omits description when not provided', () => {
    const card: AgentCardInput = { ...baseCard, description: undefined };
    const record = agentCardToOASF(card);
    expect(record.description).toBeUndefined();
  });

  it('omits status for non-standard values', () => {
    const card: AgentCardInput = { ...baseCard, status: 'weird' };
    const record = agentCardToOASF(card);
    expect(record.status).toBeUndefined();
  });
});

// ── 2. Endpoint integration tests ───────────────────────

describe('GET /call/:moltNumber/oasf.json', () => {
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

  beforeAll(() => {
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
        nationCode: 'MOLT',
        carrierDomain: 'moltphone.ai',
        issuedAt: 1234567890,
        signature: 'mock-sig',
      }),
      registrationCertToJSON: jest.fn().mockImplementation((cert: Record<string, unknown>) => ({
        version: cert.version ?? '1',
        molt_number: cert.moltNumber ?? 'MOCK',
        agent_public_key: cert.agentPublicKey ?? 'mock',
        nation_code: cert.nationCode ?? 'MOLT',
        carrier_domain: cert.carrierDomain ?? 'moltphone.ai',
        issued_at: cert.issuedAt ?? 1234567890,
        signature: cert.signature ?? 'mock-sig',
      })),
      CARRIER_DOMAIN: 'moltphone.ai',
    }));

    jest.mock('@/lib/call-url', () => ({
      callUrl: jest.fn((num: string, path: string) => `http://localhost:3000/call/${num}${path}`),
    }));
  });

  // Dynamic import after mocks are set up
  let getOasf: any;
  beforeAll(async () => {
    const mod = await import('../../app/call/[moltNumber]/oasf.json/route');
    getOasf = mod.GET;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetAgentCounter();
    mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
    mockPrisma.nonceUsed.create.mockResolvedValue({});
  });

  it('returns OASF record for public agent without auth', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.oasf_schema).toBe('1.0.0');
    expect(body.name).toBe(agent.displayName);
    expect(body.agent_ref).toBe(agent.moltNumber);
  });

  it('includes x-molt module with Molt-specific data', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.modules).toBeDefined();
    expect(body.modules['x-molt']).toBeDefined();
    expect(body.modules['x-molt'].molt_number).toBe(agent.moltNumber);
    expect(body.modules['x-molt'].nation).toBe('MOLT');
    expect(body.modules['x-molt'].public_key).toBe(agent.publicKey);
  });

  it('includes locators pointing to carrier call endpoints', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.locators).toHaveLength(2);
    expect(body.locators[0].type).toBe('a2a');
    expect(body.locators[0].url).toContain('/tasks/send');
    expect(body.locators[1].type).toBe('agent-card');
    expect(body.locators[1].url).toContain('/agent.json');
  });

  it('returns 404 for nonexistent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('GET', `/call/FAKE-0000-0000-0000/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: 'FAKE-0000-0000-0000' }) });

    expect(res.status).toBe(404);
  });

  it('requires auth for non-public agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'registered_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('allows authenticated access to non-public agents', async () => {
    const target = buildMockAgent({ inboundPolicy: 'registered_only' });
    const caller = buildMockAgent({ inboundPolicy: 'public' });

    mockPrisma.agent.findUnique.mockResolvedValue(target);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);

    const req = buildSignedRequest(
      'GET',
      `/call/${target.moltNumber}/oasf.json`,
      caller,
      { targetMoltNumber: target.moltNumber },
    );
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: target.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.oasf_schema).toBe('1.0.0');
  });

  it('never leaks endpointUrl in OASF export', async () => {
    const agent = buildMockAgent({
      inboundPolicy: 'public',
      endpointUrl: 'https://secret-webhook.example.com/handle',
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res = await getOasf(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();
    const json = JSON.stringify(body);

    expect(json).not.toContain('secret-webhook');
    expect(json).not.toContain('endpointUrl');
    expect(json).not.toContain('endpoint_url');
  });

  it('produces stable output for the same agent', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req1 = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res1 = await getOasf(req1, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body1 = await res1.json();

    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    const req2 = buildRequest('GET', `/call/${agent.moltNumber}/oasf.json`);
    const res2 = await getOasf(req2, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body2 = await res2.json();

    expect(JSON.stringify(body1)).toBe(JSON.stringify(body2));
  });
});
