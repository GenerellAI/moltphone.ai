/**
 * Tests for inbound call handling endpoints:
 * - POST /api/tasks/:taskId/accept
 * - POST /api/tasks/:taskId/decline
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TEST_USER, TEST_ADMIN } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  task: {
    findUnique: jest.fn(),
    update: jest.fn(),
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

import { POST as acceptCall } from '../../app/api/tasks/[taskId]/accept/route';
import { POST as declineCall } from '../../app/api/tasks/[taskId]/decline/route';
import { NextRequest } from 'next/server';

// ── Helpers ──────────────────────────────────────────────

function buildReq(taskId: string): [NextRequest, { params: Promise<{ taskId: string }> }] {
  const req = new NextRequest(`http://localhost:3000/api/tasks/${taskId}/accept`, { method: 'POST' });
  return [req, { params: Promise.resolve({ taskId }) }];
}

const mockTask = {
  id: 'task-1',
  taskId: 'ext-1',
  intent: 'call',
  status: 'submitted',
  calleeId: 'agent-callee',
  callerId: 'agent-caller',
  callee: { id: 'agent-callee', ownerId: TEST_USER.id, moltNumber: 'TEST-AAAA-BBBB-CCCC', displayName: 'Callee' },
  caller: { id: 'agent-caller', ownerId: TEST_ADMIN.id, moltNumber: 'TEST-DDDD-EEEE-FFFF', displayName: 'Caller' },
};

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
  });
  mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask });
  mockPrisma.taskEvent.count.mockResolvedValue(1);
  mockPrisma.$transaction.mockResolvedValue([{}, {}]);
});

// ── POST /api/tasks/:taskId/accept ───────────────────────

describe('POST /api/tasks/:taskId/accept', () => {
  it('accepts a ringing call and transitions to working', async () => {
    const [req, ctx] = buildReq('task-1');
    const res = await acceptCall(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, id: 'task-1', status: 'working' });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPublishTaskEvent).toHaveBeenCalledWith(
      expect.arrayContaining(['agent-callee', 'agent-caller']),
      expect.objectContaining({ type: 'task.status', payload: expect.objectContaining({ action: 'accepted' }) }),
    );
  });

  it('rejects if user is not the callee owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_ADMIN.id, email: TEST_ADMIN.email, name: TEST_ADMIN.name },
    });
    const [req, ctx] = buildReq('task-1');
    const res = await acceptCall(req, ctx);
    expect(res.status).toBe(403);
  });

  it('rejects if task is not in submitted state', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask, status: 'working' });
    const [req, ctx] = buildReq('task-1');
    const res = await acceptCall(req, ctx);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown task', async () => {
    mockPrisma.task.findUnique.mockResolvedValue(null);
    const [req, ctx] = buildReq('task-xxx');
    const res = await acceptCall(req, ctx);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const [req, ctx] = buildReq('task-1');
    const res = await acceptCall(req, ctx);
    expect(res.status).toBe(401);
  });
});

// ── POST /api/tasks/:taskId/decline ──────────────────────

describe('POST /api/tasks/:taskId/decline', () => {
  it('declines a ringing call and transitions to canceled', async () => {
    const [req, ctx] = buildReq('task-1');
    const res = await declineCall(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true, id: 'task-1', status: 'canceled' });
    expect(mockPublishTaskEvent).toHaveBeenCalledWith(
      expect.arrayContaining(['agent-callee', 'agent-caller']),
      expect.objectContaining({ type: 'task.canceled', payload: expect.objectContaining({ action: 'declined' }) }),
    );
  });

  it('rejects if user is not the callee owner', async () => {
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_ADMIN.id, email: TEST_ADMIN.email, name: TEST_ADMIN.name },
    });
    const [req, ctx] = buildReq('task-1');
    const res = await declineCall(req, ctx);
    expect(res.status).toBe(403);
  });

  it('rejects if task is not in submitted state', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ ...mockTask, status: 'completed' });
    const [req, ctx] = buildReq('task-1');
    const res = await declineCall(req, ctx);
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const [req, ctx] = buildReq('task-1');
    const res = await declineCall(req, ctx);
    expect(res.status).toBe(401);
  });
});
