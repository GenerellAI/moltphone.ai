/**
 * Integration tests for GET /call/:moltNumber/tasks (inbox poll)
 *
 * Tests: authenticated inbox access, Ed25519 verification, nonce replay,
 * caller mismatch, presence side-effect, result shape.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildSignedRequest, buildMockAgent, buildRequest, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  task: {
    findMany: jest.fn(),
  },
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { GET as inboxPoll } from '../../app/call/[moltNumber]/tasks/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
  mockPrisma.nonceUsed.create.mockResolvedValue({});
  mockPrisma.agent.update.mockResolvedValue({});
  mockPrisma.task.findMany.mockResolvedValue([]);
});

// ── Happy path ───────────────────────────────────────────

describe('GET /call/:moltNumber/tasks — inbox', () => {
  it('returns pending tasks for authenticated agent', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findMany.mockResolvedValue([
      { id: 'task-1', taskId: 'ext-1', status: 'submitted', messages: [] },
      { id: 'task-2', taskId: 'ext-2', status: 'input_required', messages: [] },
    ]);

    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, agent);
    const res = await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tasks).toHaveLength(2);
  });

  it('updates lastSeenAt (presence heartbeat side-effect)', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, agent);
    await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(mockPrisma.agent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: agent.id }, data: expect.objectContaining({ lastSeenAt: expect.any(Date) }) }),
    );
  });

  it('records nonce to prevent replay', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, agent);
    await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(mockPrisma.nonceUsed.create).toHaveBeenCalled();
  });
});

// ── Auth failures ────────────────────────────────────────

describe('GET /call/:moltNumber/tasks — auth', () => {
  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const agent = buildMockAgent();
    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, agent);
    const res = await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/call/${agent.moltNumber}/tasks`);
    const res = await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });

  it('rejects caller mismatch (agent cannot poll someone else inbox)', async () => {
    const agent = buildMockAgent();
    const other = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    // Sign as 'other' but target agent's inbox
    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, other, {
      targetMoltNumber: agent.moltNumber,
    });
    const res = await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(403);
  });

  it('rejects nonce replay', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.nonceUsed.findUnique.mockResolvedValue({ id: 'exists' });

    const req = buildSignedRequest('GET', `/call/${agent.moltNumber}/tasks`, agent);
    const res = await inboxPoll(req, { params: Promise.resolve({ moltNumber: agent.moltNumber }) });

    expect(res.status).toBe(401);
  });
});
