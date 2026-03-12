/**
 * Tests for task retention — cleanup cron endpoint and config constants.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest, TEST_ADMIN } from './helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  task: {
    findMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  taskMessage: {
    deleteMany: jest.fn(),
  },
  taskEvent: {
    deleteMany: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

import { POST as taskCleanup } from '../app/api/admin/task-cleanup/route';
import { TASK_RETENTION_DAYS, MAX_TASKS_PER_AGENT } from '../carrier.config';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { id: TEST_ADMIN.id, email: TEST_ADMIN.email, role: 'admin' },
  });
  // For requireAdmin
  (mockPrisma as any).user = { findUnique: jest.fn().mockResolvedValue({ id: TEST_ADMIN.id, role: 'admin' }) };
});

// ── Config tests ─────────────────────────────────────────

describe('Task retention config', () => {
  it('TASK_RETENTION_DAYS defaults to 30', () => {
    expect(TASK_RETENTION_DAYS).toBe(30);
  });

  it('MAX_TASKS_PER_AGENT defaults to 1000', () => {
    expect(MAX_TASKS_PER_AGENT).toBe(1000);
  });

  it('TASK_RETENTION_DAYS is a positive number', () => {
    expect(TASK_RETENTION_DAYS).toBeGreaterThan(0);
  });

  it('MAX_TASKS_PER_AGENT is a positive number', () => {
    expect(MAX_TASKS_PER_AGENT).toBeGreaterThan(0);
  });
});

// ── Cron endpoint tests ──────────────────────────────────

describe('POST /api/admin/task-cleanup', () => {
  it('authenticates via CRON_SECRET', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    mockPrisma.task.findMany.mockResolvedValue([]);

    const req = buildRequest('POST', '/api/admin/task-cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    });

    const res = await taskCleanup(req);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.deleted).toBe(0);
    expect(data.messages).toBe(0);
    expect(data.events).toBe(0);

    delete process.env.CRON_SECRET;
  });

  it('deletes old tasks with their messages and events', async () => {
    process.env.CRON_SECRET = 'test-secret';

    const oldTasks = [
      { id: 'task-old-1' },
      { id: 'task-old-2' },
      { id: 'task-old-3' },
    ];
    mockPrisma.task.findMany.mockResolvedValue(oldTasks);
    mockPrisma.$transaction.mockResolvedValue([
      { count: 5 },  // events deleted
      { count: 6 },  // messages deleted
      { count: 3 },  // tasks deleted
    ]);

    const req = buildRequest('POST', '/api/admin/task-cleanup', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const res = await taskCleanup(req);
    const data = await res.json();

    expect(data.deleted).toBe(3);
    expect(data.messages).toBe(6);
    expect(data.events).toBe(5);
    expect(data.retentionDays).toBe(30);
    expect(data.cutoff).toBeDefined();

    // Verify deletes were called with correct IDs
    expect(mockPrisma.taskEvent.deleteMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['task-old-1', 'task-old-2', 'task-old-3'] } },
    });
    expect(mockPrisma.taskMessage.deleteMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['task-old-1', 'task-old-2', 'task-old-3'] } },
    });
    expect(mockPrisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['task-old-1', 'task-old-2', 'task-old-3'] } },
    });
    expect(mockPrisma.$transaction).toHaveBeenCalled();

    delete process.env.CRON_SECRET;
  });

  it('returns zero counts when nothing to clean', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mockPrisma.task.findMany.mockResolvedValue([]);

    const req = buildRequest('POST', '/api/admin/task-cleanup', {
      headers: { authorization: 'Bearer test-secret' },
    });

    const res = await taskCleanup(req);
    const data = await res.json();

    expect(data.deleted).toBe(0);
    expect(data.messages).toBe(0);
    expect(data.events).toBe(0);

    delete process.env.CRON_SECRET;
  });

  it('uses correct cutoff date based on TASK_RETENTION_DAYS', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mockPrisma.task.findMany.mockResolvedValue([]);

    const before = Date.now();
    const req = buildRequest('POST', '/api/admin/task-cleanup', {
      headers: { authorization: 'Bearer test-secret' },
    });
    await taskCleanup(req);
    const after = Date.now();

    // The findMany should have been called with a cutoff ~30 days ago
    const call = mockPrisma.task.findMany.mock.calls[0][0];
    const cutoff = call.where.createdAt.lt;
    const expectedCutoffMs = TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000;

    expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(expectedCutoffMs - 1000);
    expect(after - cutoff.getTime()).toBeLessThanOrEqual(expectedCutoffMs + 1000);

    delete process.env.CRON_SECRET;
  });

  it('only targets terminal statuses (completed, canceled, failed)', async () => {
    process.env.CRON_SECRET = 'test-secret';
    mockPrisma.task.findMany.mockResolvedValue([]);

    const req = buildRequest('POST', '/api/admin/task-cleanup', {
      headers: { authorization: 'Bearer test-secret' },
    });
    await taskCleanup(req);

    const call = mockPrisma.task.findMany.mock.calls[0][0];
    expect(call.where.status.in).toEqual(
      expect.arrayContaining(['completed', 'canceled', 'failed'])
    );
    // Should NOT include active statuses
    expect(call.where.status.in).not.toContain('submitted');
    expect(call.where.status.in).not.toContain('working');
    expect(call.where.status.in).not.toContain('input_required');

    delete process.env.CRON_SECRET;
  });
});
