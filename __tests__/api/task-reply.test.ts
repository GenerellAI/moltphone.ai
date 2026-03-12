/**
 * Tests for POST /api/tasks/:taskId/reply — UI reply to a task.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TEST_USER, TEST_ADMIN } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
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
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockPublishTaskEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/sse-events', () => ({
  publishTaskEvent: (...args: any[]) => mockPublishTaskEvent(...args),
}));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

import { POST as replyToTask } from '../../app/api/tasks/[taskId]/reply/route';
import { NextRequest } from 'next/server';

// ── Helpers ──────────────────────────────────────────────

function buildReq(taskId: string, body: unknown): [NextRequest, { params: Promise<{ taskId: string }> }] {
  const req = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/reply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return [req, { params: Promise.resolve({ taskId }) }];
}

const mockTask = {
  id: 'task-1',
  taskId: 'ext-1',
  intent: 'call',
  status: 'working',
  calleeId: 'agent-callee',
  callerId: 'agent-caller',
  callee: { id: 'agent-callee', ownerId: TEST_USER.id, moltNumber: 'TEST-AAAA-BBBB-CCCC', displayName: 'Callee' },
  caller: { id: 'agent-caller', ownerId: TEST_ADMIN.id, moltNumber: 'TEST-DDDD-EEEE-FFFF', displayName: 'Caller' },
};

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({ user: { id: TEST_USER.id } });
  mockPrisma.task.findUnique.mockResolvedValue(mockTask);
  mockPrisma.taskEvent.count.mockResolvedValue(2);
  mockPrisma.$transaction.mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────

describe('POST /api/tasks/:taskId/reply', () => {
  it('returns 401 without session', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await replyToTask(...buildReq('task-1', { message: 'hello' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for empty message', async () => {
    const res = await replyToTask(...buildReq('task-1', { message: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing message', async () => {
    const res = await replyToTask(...buildReq('task-1', {}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when task not found', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const res = await replyToTask(...buildReq('task-1', { message: 'hello' }));
    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not owner', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: 'stranger' } });
    const res = await replyToTask(...buildReq('task-1', { message: 'hello' }));
    expect(res.status).toBe(403);
  });

  it('returns 400 for completed tasks', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask, status: 'completed' });
    const res = await replyToTask(...buildReq('task-1', { message: 'hello' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/completed/);
  });

  it('returns 400 for canceled tasks', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask, status: 'canceled' });
    const res = await replyToTask(...buildReq('task-1', { message: 'hello' }));
    expect(res.status).toBe(400);
  });

  it('sends reply as agent when callee replies', async () => {
    const res = await replyToTask(...buildReq('task-1', { message: 'Hello back!' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe('working');

    // Check transaction was called with 3 operations
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const txArgs = mockPrisma.$transaction.mock.calls[0][0];
    expect(txArgs).toHaveLength(3);

    // Check SSE event was published
    expect(mockPublishTaskEvent).toHaveBeenCalledWith(
      expect.arrayContaining(['agent-callee', 'agent-caller']),
      expect.objectContaining({
        taskId: 'task-1',
        type: 'task.message',
      }),
    );
  });

  it('sends reply as user when caller replies', async () => {
    mockGetServerSession.mockResolvedValue({ user: { id: TEST_ADMIN.id } });
    const res = await replyToTask(...buildReq('task-1', { message: 'Follow-up question' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
  });

  it('transitions submitted task to working on reply', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask, status: 'submitted' });
    const res = await replyToTask(...buildReq('task-1', { message: 'Picking up via reply' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('working');
  });

  it('marks task as completed when final=true', async () => {
    const res = await replyToTask(...buildReq('task-1', { message: 'Goodbye!', final: true }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('completed');
  });
});
