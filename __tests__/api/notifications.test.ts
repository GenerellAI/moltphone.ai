/**
 * Tests for notification badge endpoints:
 * - GET /api/notifications/unread
 * - POST /api/notifications/mark-seen
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest, TEST_USER } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  agent: {
    findMany: jest.fn(),
  },
  task: {
    count: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

import { GET as getUnread } from '../../app/api/notifications/unread/route';
import { POST as markSeen } from '../../app/api/notifications/mark-seen/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockGetServerSession.mockResolvedValue({
    user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
  });
});

// ── GET /api/notifications/unread ────────────────────────

describe('GET /api/notifications/unread', () => {
  it('returns unread counts', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      lastSeenCallAt: new Date('2025-01-01'),
      lastSeenMessageAt: new Date('2025-01-01'),
    });
    mockPrisma.agent.findMany.mockResolvedValue([{ id: 'agent-1' }]);
    mockPrisma.task.count.mockResolvedValueOnce(3).mockResolvedValueOnce(5);

    const res = await getUnread();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ calls: 3, messages: 5 });
  });

  it('returns zeros when user has no agents', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      lastSeenCallAt: null,
      lastSeenMessageAt: null,
    });
    mockPrisma.agent.findMany.mockResolvedValue([]);

    const res = await getUnread();
    const body = await res.json();

    expect(body).toEqual({ calls: 0, messages: 0 });
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await getUnread();
    expect(res.status).toBe(401);
  });
});

// ── POST /api/notifications/mark-seen ────────────────────

describe('POST /api/notifications/mark-seen', () => {
  it('marks calls as seen', async () => {
    mockPrisma.user.update.mockResolvedValue({});

    const req = buildRequest('POST', '/api/notifications/mark-seen', {
      body: { type: 'call' },
    });
    const res = await markSeen(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER.id },
      data: expect.objectContaining({ lastSeenCallAt: expect.any(Date) }),
    });
  });

  it('marks messages as seen', async () => {
    mockPrisma.user.update.mockResolvedValue({});

    const req = buildRequest('POST', '/api/notifications/mark-seen', {
      body: { type: 'text' },
    });
    const res = await markSeen(req);
    const body = await res.json();

    expect(body).toEqual({ ok: true });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: TEST_USER.id },
      data: expect.objectContaining({ lastSeenMessageAt: expect.any(Date) }),
    });
  });

  it('rejects invalid type', async () => {
    const req = buildRequest('POST', '/api/notifications/mark-seen', {
      body: { type: 'invalid' },
    });
    const res = await markSeen(req);
    expect(res.status).toBe(400);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);
    const req = buildRequest('POST', '/api/notifications/mark-seen', {
      body: { type: 'call' },
    });
    const res = await markSeen(req);
    expect(res.status).toBe(401);
  });
});
