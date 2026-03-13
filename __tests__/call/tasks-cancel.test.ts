/**
 * Integration tests for POST /call/:moltNumber/tasks/:taskId/cancel
 *
 * Tests: callee cancel, caller cancel, auth, nonce replay, closed task,
 * unauthorized third-party cancel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildSignedRequest, buildMockAgent, buildRequest, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  task: {
    findUnique: jest.fn(),
    update: jest.fn(),
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

import { POST as taskCancel } from '../../app/call/[moltNumber]/tasks/[taskId]/cancel/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockPrisma.nonceUsed.findUnique.mockResolvedValue(null);
  mockPrisma.nonceUsed.create.mockResolvedValue({});
  mockPrisma.taskEvent.count.mockResolvedValue(0);
  mockPrisma.$transaction.mockResolvedValue([{}, {}]);
});

function mockTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    taskId: 'ext-1',
    calleeId: 'agent-1',
    callerId: 'caller-1',
    status: 'working',
    caller: { moltNumber: 'MPHO-AAAA-BBBB-CCCC-DDDD' },
    ...overrides,
  };
}

// ── Callee cancels own task ──────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/cancel — callee', () => {
  it('callee ending a connected call sets completed', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'working' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('completed');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });

  it('callee ending a ringing (submitted) call sets canceled (missed call)', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'submitted' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('canceled');
  });
});

// ── Caller cancels task ──────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/cancel — caller', () => {
  it('original caller ending a connected call sets completed', async () => {
    const callee = buildMockAgent();
    const caller = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(callee);
    mockPrisma.agent.findFirst.mockResolvedValue(caller);
    mockPrisma.task.findUnique.mockResolvedValue(
      mockTask({ calleeId: callee.id, status: 'working', caller: { moltNumber: caller.moltNumber } }),
    );

    const req = buildSignedRequest(
      'POST',
      `/call/${callee.moltNumber}/tasks/task-1/cancel`,
      caller,
      { body: {}, targetMoltNumber: callee.moltNumber },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: callee.moltNumber, taskId: 'task-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe('completed');
  });
});

// ── Auth failures ────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/cancel — auth', () => {
  it('rejects unauthenticated requests', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('POST', `/call/${agent.moltNumber}/tasks/task-1/cancel`, {
      body: {},
    });
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('rejects unauthorized third party', async () => {
    const callee = buildMockAgent();
    const thirdParty = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(callee);
    mockPrisma.agent.findFirst.mockResolvedValue(thirdParty);
    mockPrisma.task.findUnique.mockResolvedValue(
      mockTask({ calleeId: callee.id, caller: { moltNumber: 'MPHO-XXXX-YYYY-ZZZZ-AAAA' } }),
    );

    const req = buildSignedRequest(
      'POST',
      `/call/${callee.moltNumber}/tasks/task-1/cancel`,
      thirdParty,
      { body: {}, targetMoltNumber: callee.moltNumber },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: callee.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects nonce replay', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.nonceUsed.findUnique.mockResolvedValue({ id: 'exists' });

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(401);
  });
});

// ── Task state ───────────────────────────────────────────

describe('POST /call/:moltNumber/tasks/:taskId/cancel — state', () => {
  it('returns 404 for non-existent task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(null);

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(404);
  });

  it('rejects cancel of completed task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'completed' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects cancel of already-canceled task', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.agent.findFirst.mockResolvedValue(agent);
    mockPrisma.task.findUnique.mockResolvedValue(mockTask({ calleeId: agent.id, status: 'canceled' }));

    const req = buildSignedRequest(
      'POST',
      `/call/${agent.moltNumber}/tasks/task-1/cancel`,
      agent,
      { body: {} },
    );
    const res = await taskCancel(req, {
      params: Promise.resolve({ moltNumber: agent.moltNumber, taskId: 'task-1' }),
    });

    expect(res.status).toBe(409);
  });
});
