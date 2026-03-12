/**
 * Integration tests for admin routes:
 * - /api/admin/carrier-blocks (GET, POST)
 * - /api/admin/nonce-cleanup (POST)
 * - /api/admin/credits/grant (POST)
 *
 * Tests: admin-only access, CRUD, cron auth, validation.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest, TEST_USER, TEST_ADMIN, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  carrierBlock: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  nonceUsed: {
    deleteMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  creditTransaction: {
    create: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockAdminGrantCredits = jest.fn();
jest.mock('@/lib/services/credits', () => ({
  adminGrantCredits: (...args: any[]) => mockAdminGrantCredits(...args),
}));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

import { GET as listBlocks, POST as createBlock } from '../../app/api/admin/carrier-blocks/route';
import { POST as nonceCleanup } from '../../app/api/admin/nonce-cleanup/route';
import { POST as grantCredits } from '../../app/api/admin/credits/grant/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  // Default: admin session
  mockGetServerSession.mockResolvedValue({
    user: { id: TEST_ADMIN.id, email: TEST_ADMIN.email, name: TEST_ADMIN.name },
  });
  mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_ADMIN.id, role: 'admin' });
});

// ── Carrier Blocks ───────────────────────────────────────

describe('GET /api/admin/carrier-blocks', () => {
  it('returns active blocks', async () => {
    mockPrisma.carrierBlock.findMany.mockResolvedValue([
      { id: 'cb-1', type: 'agent_id', value: 'bad-agent', isActive: true },
    ]);

    const res = await listBlocks();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('rejects non-admin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, role: 'user' });
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
    });

    const res = await listBlocks();
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await listBlocks();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/carrier-blocks', () => {
  it('creates a carrier block', async () => {
    mockPrisma.carrierBlock.upsert.mockResolvedValue({
      id: 'cb-1',
      type: 'agent_id',
      value: 'bad-agent',
      isActive: true,
    });

    const req = buildRequest('POST', '/api/admin/carrier-blocks', {
      body: { type: 'agent_id', value: 'bad-agent', reason: 'Spam' },
    });
    const res = await createBlock(req);

    expect(res.status).toBe(201);
  });

  it('rejects invalid block type', async () => {
    const req = buildRequest('POST', '/api/admin/carrier-blocks', {
      body: { type: 'invalid_type', value: 'test' },
    });

    // Zod validation throws; expect it to not be 201
    await expect(createBlock(req)).rejects.toThrow();
  });

  it('rejects non-admin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, role: 'user' });
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
    });

    const req = buildRequest('POST', '/api/admin/carrier-blocks', {
      body: { type: 'agent_id', value: 'bad-agent' },
    });
    const res = await createBlock(req);
    expect(res.status).toBe(403);
  });
});

// ── Nonce Cleanup ────────────────────────────────────────

describe('POST /api/admin/nonce-cleanup', () => {
  it('prunes expired nonces for admin', async () => {
    mockPrisma.nonceUsed.deleteMany.mockResolvedValue({ count: 42 });

    const req = buildRequest('POST', '/api/admin/nonce-cleanup');
    const res = await nonceCleanup(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(42);
  });

  it('accepts CRON_SECRET bearer token', async () => {
    process.env.CRON_SECRET = 'test-cron-secret';
    mockGetServerSession.mockResolvedValue(null); // no session

    mockPrisma.nonceUsed.deleteMany.mockResolvedValue({ count: 10 });

    const req = buildRequest('POST', '/api/admin/nonce-cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    const res = await nonceCleanup(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.deleted).toBe(10);

    delete process.env.CRON_SECRET;
  });

  it('rejects non-admin without cron secret', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, role: 'user' });
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
    });

    const req = buildRequest('POST', '/api/admin/nonce-cleanup');
    const res = await nonceCleanup(req);
    expect(res.status).toBe(403);
  });
});

// ── Credits Grant ────────────────────────────────────────

describe('POST /api/admin/credits/grant', () => {
  it('grants credits to a user', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: TEST_ADMIN.id, role: 'admin' })  // requireAdmin
      .mockResolvedValueOnce({ id: TEST_USER.id, credits: 10000 });  // target user
    mockAdminGrantCredits.mockResolvedValue(15000);

    const req = buildRequest('POST', '/api/admin/credits/grant', {
      body: { userId: TEST_USER.id, amount: 5000, description: 'Test grant' },
    });
    const res = await grantCredits(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.balance).toBe(15000);
  });

  it('rejects non-admin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, role: 'user' });
    mockGetServerSession.mockResolvedValue({
      user: { id: TEST_USER.id, email: TEST_USER.email, name: TEST_USER.name },
    });

    const req = buildRequest('POST', '/api/admin/credits/grant', {
      body: { userId: TEST_USER.id, amount: 5000 },
    });
    const res = await grantCredits(req);
    expect(res.status).toBe(403);
  });
});
