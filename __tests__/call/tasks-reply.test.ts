/**
 * Integration tests for POST /call/:moltNumber/tasks/:taskId/reply
 *
 * Tests: authenticated reply, body validation, task state transitions,
 * carrier_only relay charging, nonce replay, closed-task rejection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildSignedRequest, buildMockAgent, buildRequest, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
  },
  task: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  taskMessage: {
    create: jest.fn(),
  },
  taskEvent: {
    count: jest.fn(),
    create: jest.fn(),
  },
  nonceUsed: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

jest.mock('@/lib/services/credits', () => ({
  calculateMessageCost: jest.fn().mockReturnValue(1),
  deductRelayCredits: jest.fn().mockResolvedValue({ ok: true, balance: 9999 }),
}));

import { POST as taskReply } from '../../app/call/[moltNumber]/tasks/[taskId]/reply/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
  mockPrisma.nonceUsed.create.mockResolvedValue({});
  mockPrisma.taskEvent.count.mockResolvedValue(0);
  mockPrisma.$transaction.mockResolvedValue([{}, {}, {}]);
});

function validReplyBody(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      parts: [{ type: 'text', text: 'Thanks for reaching out!' }],
    },
    ...overrides,
  };
}

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    taskId: 'ext-1',
    calleeId: 'agent-1',
    callerId: 'caller-1',
    status: 'submitted',
    ...overrides,
  };
}

// ── Happy path ───────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/reply — basic', () => {
  it('replies to a submitted task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('input_required');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('marks task as completed when final=true', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody({ final: true }) },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });
    const body = await res.json();

    expect(body.status).toBe('completed');
  });
});

// ── Auth failures ────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/reply — auth', () => {
  it('rejects unauthenticated requests', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/task-1/reply`, {
      body: validReplyBody(),
    });
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects non-callee from replying', async () => {
    const agent = buildMockAgent();
    const other = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      other,
      { body: validReplyBody(), targetMoltNumber: agent.moltNumber },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects nonce replay', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.nonceUsed.findUnique.mockResolvedValue({ id: 'exists' });

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(401);
  });
});

// ── Task state ───────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/reply — state', () => {
  it('returns 404 for non-existent task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(404);
  });

  it('rejects reply to completed task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'completed' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects reply to canceled task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'canceled' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(409);
  });
});

// ── Body validation ──────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/reply — validation', () => {
  it('rejects invalid body', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: { invalid: true } },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects empty parts array', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: { message: { parts: [] } } },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(400);
  });
});

// ── carrier_only relay charging ──────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/reply — relay', () => {
  it('charges relay credits for carrier_only agents', async () => {
    const { deductRelayCredits } = require('@/lib/services/credits');
    const agent = buildMockAgent({ directConnectionPolicy: 'carrier_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(deductRelayCredits).toHaveBeenCalled();
  });

  it('rejects when insufficient credits', async () => {
    const { deductRelayCredits } = require('@/lib/services/credits');
    deductRelayCredits.mockResolvedValueOnce({ ok: false, balance: 0 });
    const agent = buildMockAgent({ directConnectionPolicy: 'carrier_only' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/reply`,
      agent,
      { body: validReplyBody() },
    );
    const res = await taskReply(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(403);
  });
});
