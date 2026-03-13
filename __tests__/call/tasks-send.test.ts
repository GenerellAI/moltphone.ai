/**
 * Integration tests for the call protocol — POST /call/:moltNumber/tasks/send
 *
 * Tests: public delivery, policy enforcement, DND queuing, busy queuing,
 * offline queuing, forwarding, webhook delivery, rate limiting, blocks,
 * carrier identity headers, error codes.
 *
 * Mocks: Prisma, SSRF, rate limiter, webhook reliability, push notifications,
 *        carrier identity, carrier policies, credits.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest, buildMockAgent, resetAgentCounter, TEST_USER } from '../helpers/setup';
import { generateKeyPair, signRequest, computeBodyHash } from '../../lib/ed25519';
import { generateMoltNumber } from '../../lib/molt-number';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  task: {
    create: jest.fn(),
    count: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn(),
  },
  block: {
    findFirst: jest.fn(),
  },
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  carrierBlock: {
    findMany: jest.fn(),
  },
  carrierPolicy: {
    findMany: jest.fn(),
  },
  registryNumberBinding: {
    findUnique: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock carrier boot (no-op)
jest.mock('@/lib/carrier-boot', () => ({
  ensureCarrierRegistered: jest.fn().mockResolvedValue(undefined),
}));

// Helper: configure findUnique to always return agent for any call
function stubAgent(agent: ReturnType<typeof buildMockAgent>) {
  mockPrisma.agent.findUnique.mockResolvedValue(agent);
}

// Mock rate limiter (always allow by default)
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ ok: true }),
  rateLimitKey: jest.fn().mockReturnValue('test-key'),
  rateLimitPerTarget: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock SSRF (always pass)
jest.mock('@/lib/ssrf', () => ({
  validateWebhookUrl: jest.fn().mockResolvedValue({ ok: true }),
  checkEndpointOwnership: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock webhook reliability
jest.mock('@/lib/services/webhook-reliability', () => ({
  getCircuitState: jest.fn().mockReturnValue('closed'),
  recordSuccess: jest.fn().mockResolvedValue(undefined),
  recordFailure: jest.fn().mockResolvedValue(undefined),
  scheduleRetry: jest.fn().mockResolvedValue(undefined),
}));

// Mock push notifications (no-op)
jest.mock('@/lib/services/push-notifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
}));

// Mock carrier identity (pass-through)
jest.mock('@/lib/carrier-identity', () => ({
  signDelivery: jest.fn().mockReturnValue({
    'X-Molt-Identity': 'mock-sig',
    'X-Molt-Identity-Carrier': 'moltphone.ai',
    'X-Molt-Identity-Attest': 'A',
    'X-Molt-Identity-Timestamp': '1234567890',
  }),
  determineAttestation: jest.fn().mockReturnValue('A'),
}));

// Mock carrier policies (always pass)
jest.mock('@/lib/services/carrier-policies', () => ({
  checkCarrierPolicies: jest.fn().mockResolvedValue({ ok: true }),
}));

// Mock credits (always pass)
jest.mock('@/lib/services/credits', () => ({
  calculateMessageCost: jest.fn().mockReturnValue(1),
  deductRelayCredits: jest.fn().mockResolvedValue({ ok: true, balance: 9999 }),
}));

// Mock presence
jest.mock('@/lib/presence', () => ({
  isOnline: jest.fn().mockReturnValue(false),
}));

// Import route AFTER mocks
import { POST as tasksSend } from '../../app/call/[moltNumber]/tasks/send/route';

// ── Helpers ──────────────────────────────────────────────

function validTaskBody(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    message: {
      parts: [{ type: 'text', text: 'Hello, agent!' }],
    },
    metadata: {
      'molt.intent': 'text',
    },
    ...overrides,
  };
}

function createTaskReturn(overrides: Record<string, unknown> = {}) {
  return {
    id: 'created-task-id',
    taskId: 'task-1',
    calleeId: 'agent-1',
    callerId: null,
    intent: 'text',
    status: 'submitted',
    createdAt: new Date(),
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.carrierBlock.findMany.mockResolvedValue([]);
  mockPrisma.carrierPolicy.findMany.mockResolvedValue([]);
  mockPrisma.block.findFirst.mockResolvedValue(null);
  mockPrisma.task.count.mockResolvedValue(0);
  mockPrisma.task.create.mockResolvedValue(createTaskReturn());
  mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });
});

// ── Basic delivery ───────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — basic', () => {
  it('queues task for offline public agent', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    // HTTP 503 (SIP-style 480 in body)
    expect(res.status).toBe(503);
    expect(body.error.code).toBe(480);
    expect(body.error.data.task_id).toBeDefined();
    expect(body.error.data.away_message).toBeNull();
  });

  it('includes away message when agent is offline and has one', async () => {
    const agent = buildMockAgent({ awayMessage: 'I am away!' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(body.error.data.away_message).toBe('I am away!');
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('POST', '/call/MPHO-XXXX-YYYY-ZZZZ-AAAA/tasks/send', {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: 'MPHO-XXXX-YYYY-ZZZZ-AAAA' }) });

    expect(res.status).toBe(404);
  });

  it('returns 403 when calling is disabled', async () => {
    const agent = buildMockAgent({ callEnabled: false });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('rejects invalid request body', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: { invalid: true }, // missing message.parts
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(400);
  });
});

// ── DND ──────────────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — DND', () => {
  it('returns 503 (DND 487) when agent is on DND', async () => {
    const agent = buildMockAgent({ dndEnabled: true });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe(487);
  });

  it('sends push notification on DND if push endpoint set', async () => {
    const { sendPushNotification } = require('@/lib/services/push-notifications');
    const agent = buildMockAgent({ dndEnabled: true, pushEndpointUrl: 'https://push.example.com' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(sendPushNotification).toHaveBeenCalledWith(
      'https://push.example.com',
      expect.objectContaining({ reason: 'dnd' }),
    );
  });
});

// ── Busy ─────────────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — busy', () => {
  it('returns 503 (busy 486) when agent is at max concurrent tasks', async () => {
    const agent = buildMockAgent({ maxConcurrentCalls: 3 });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.count.mockResolvedValue(3); // at capacity

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe(486);
  });
});

// ── Rate limiting ────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — rate limit', () => {
  it('returns 429 when rate limited', async () => {
    const { rateLimit } = require('@/lib/rate-limit');
    rateLimit.mockReturnValueOnce({ ok: false, error: 'Rate limit exceeded' });

    const req = buildRequest('POST', '/call/MPHO-XXXX-YYYY-ZZZZ-AAAA/tasks/send', {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: 'MPHO-XXXX-YYYY-ZZZZ-AAAA' }) });

    expect(res.status).toBe(429);
  });
});

// ── Policy enforcement ───────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — policy', () => {
  it('allows anonymous callers to public agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'public' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    // Should queue (agent offline by default), not policy-denied
    expect(res.status).toBe(503); // HTTP 503
    const body = await res.json();
    expect(body.error.code).toBe(480); // MoltProtocol: offline
  });

  it('rejects anonymous callers to registered_only agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'registered_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('rejects anonymous callers to allowlist agents', async () => {
    const agent = buildMockAgent({ inboundPolicy: 'allowlist' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });
});

// ── Carrier-wide blocks ──────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — carrier blocks', () => {
  it('rejects blocked callers', async () => {
    const agent = buildMockAgent();
    const callerKp = generateKeyPair();
    const callerMoltNumber = generateMoltNumber('MPHO', callerKp.publicKey);

    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue({ id: 'caller-agent', nationCode: 'MPHO' });
    mockPrisma.carrierBlock.findMany.mockResolvedValue([
      { type: 'agent_id', value: 'caller-agent', reason: 'Banned', isActive: true },
    ]);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
      headers: { 'x-molt-caller': callerMoltNumber },
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });
});

// ── Per-agent blocks ─────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — per-agent blocks', () => {
  it('rejects blocked callers', async () => {
    const agent = buildMockAgent();
    const callerKp = generateKeyPair();
    const callerMoltNumber = generateMoltNumber('MPHO', callerKp.publicKey);

    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue({ id: 'caller-agent-id', nationCode: 'MPHO' });
    mockPrisma.block.findFirst.mockResolvedValue({ id: 'block-1' }); // blocked!

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
      headers: { 'x-molt-caller': callerMoltNumber },
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });
});

// ── Webhook delivery ─────────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — webhook', () => {
  beforeEach(() => {
    const { isOnline } = require('@/lib/presence');
    isOnline.mockReturnValue(true);
  });
  afterEach(() => {
    const { isOnline } = require('@/lib/presence');
    isOnline.mockReturnValue(false);
  });

  it('delivers to webhook when agent is online with endpoint', async () => {
    const agent = buildMockAgent({
      endpointUrl: 'https://agent.example.com/webhook',
      lastSeenAt: new Date(),
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    // Mock successful webhook response
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(JSON.stringify({
        message: { parts: [{ type: 'text', text: 'Hello back!' }] },
      })),
    });
    global.fetch = mockFetch;

    mockPrisma.task.create.mockResolvedValue({
      id: 'task-live',
      status: 'working',
    });

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody({ metadata: { 'molt.intent': 'call' } }),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('working');
    expect(body.message.parts[0].text).toBe('Hello back!');

    // Verify carrier identity headers were included
    const fetchHeaders = mockFetch.mock.calls[0][1].headers;
    expect(fetchHeaders['X-Molt-Identity']).toBeDefined();
  });

  it('marks text intent as completed on successful webhook', async () => {
    const agent = buildMockAgent({
      endpointUrl: 'https://agent.example.com/webhook',
      lastSeenAt: new Date(),
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('OK'),
    });

    mockPrisma.task.create.mockResolvedValue({ id: 'task-text', status: 'completed' });

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody({ metadata: { 'molt.intent': 'text' } }),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    // Check the task was created with completed status
    const createArgs = mockPrisma.task.create.mock.calls[0][0];
    expect(createArgs.data.status).toBe('completed');
  });

  it('schedules retry on webhook failure', async () => {
    const { recordFailure, scheduleRetry } = require('@/lib/services/webhook-reliability');
    const agent = buildMockAgent({
      endpointUrl: 'https://agent.example.com/webhook',
      lastSeenAt: new Date(),
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 502 });

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(502);
    expect(recordFailure).toHaveBeenCalled();
    expect(scheduleRetry).toHaveBeenCalled();
  });

  it('returns 504 on webhook timeout', async () => {
    const agent = buildMockAgent({
      endpointUrl: 'https://agent.example.com/webhook',
      lastSeenAt: new Date(),
    });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    global.fetch = jest.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(504);
  });
});

// ── carrier_only relay charging ──────────────────────────

describe('POST /call/:moltNumber/tasks/send — carrier_only relay', () => {
  it('charges relay credits for carrier_only agents', async () => {
    const { deductRelayCredits } = require('@/lib/services/credits');
    const agent = buildMockAgent({ directConnectionPolicy: 'carrier_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(deductRelayCredits).toHaveBeenCalled();
  });

  it('rejects when carrier_only agent has insufficient credits', async () => {
    const { deductRelayCredits } = require('@/lib/services/credits');
    deductRelayCredits.mockResolvedValueOnce({ ok: false, balance: 0 });
    const agent = buildMockAgent({ directConnectionPolicy: 'carrier_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });
});

// ── Push notifications ───────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — push notifications', () => {
  it('sends push notification when offline agent has push endpoint', async () => {
    const { sendPushNotification } = require('@/lib/services/push-notifications');
    const agent = buildMockAgent({ pushEndpointUrl: 'https://push.example.com' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(sendPushNotification).toHaveBeenCalledWith(
      'https://push.example.com',
      expect.objectContaining({ reason: 'no_endpoint' }),
    );
  });
});

// ── Error code taxonomy ──────────────────────────────────

describe('POST /call/:moltNumber/tasks/send — error codes', () => {
  it('uses SIP-inspired error codes', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    // Offline → 480
    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/send`, {
      body: validTaskBody(),
    });
    const res = await tasksSend(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(503);
    expect(body.error.code).toBe(480);
    expect(body.error.message).toContain('offline');
  });
});
