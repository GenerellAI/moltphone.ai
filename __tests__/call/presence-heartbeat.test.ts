/**
 * Integration tests for POST /call/:moltNumber/presence/heartbeat
 *
 * Tests: authenticated heartbeat, presence update, nonce replay,
 * caller mismatch, 404.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildSignedRequest, buildMockAgent, buildRequest, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { POST as heartbeat } from '../../app/call/[moltNumber]/presence/heartbeat/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
  mockPrisma.nonceUsed.create.mockResolvedValue({});
  mockPrisma.agent.update.mockResolvedValue({});
});

// ── Happy path ───────────────────────────────────────────

describe('POST /call/:moltNumber/presence/heartbeat', () => {
  it('updates lastSeenAt on valid heartbeat', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    // Heartbeat uses canonical path /:moltNumber/presence/heartbeat
    const req = buildSignedRequest(
      'POST',
      `/${agent.moltNumber}/presence/heartbeat`,
      agent,
      { body: {} },
    );
    const res = await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.lastSeenAt).toBeDefined();
    expect(mockPrisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: agent.id },
        data: expect.objectContaining({ lastSeenAt: expect.any(Date) }),
      }),
    );
  });

  it('records nonce', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildSignedRequest(
      'POST',
      `/${agent.moltNumber}/presence/heartbeat`,
      agent,
      { body: {} },
    );
    await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(mockPrisma.nonceUsed.create).toHaveBeenCalled();
  });
});

// ── Auth failures ────────────────────────────────────────

describe('POST /call/:moltNumber/presence/heartbeat — auth', () => {
  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const agent = buildMockAgent();
    const req = buildSignedRequest(
      'POST',
      `/${agent.moltNumber}/presence/heartbeat`,
      agent,
      { body: {} },
    );
    const res = await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/${agent.moltNumber}/presence/heartbeat`, { body: {} });
    const res = await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('rejects caller mismatch (cannot heartbeat for another agent)', async () => {
    const agent = buildMockAgent();
    const other = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildSignedRequest(
      'POST',
      `/${agent.moltNumber}/presence/heartbeat`,
      other,
      { body: {}, targetMoltNumber: agent.moltNumber },
    );
    const res = await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('rejects nonce replay', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.nonceUsed.findUnique.mockResolvedValue({ id: 'exists' });

    const req = buildSignedRequest(
      'POST',
      `/${agent.moltNumber}/presence/heartbeat`,
      agent,
      { body: {} },
    );
    const res = await heartbeat(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });
});
