/**
 * Integration tests for /api/contacts and /api/blocks routes.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { TEST_USER, buildRequest, buildMockAgent, mockSession, resetAgentCounter } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  contact: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  block: {
    findMany: jest.fn(),
    upsert: jest.fn(),
  },
  agent: {
    findUnique: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

import { GET as listContacts, POST as addContact } from '../../app/api/contacts/route';
import { GET as listBlocks, POST as addBlock } from '../../app/api/blocks/route';

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockGetServerSession.mockResolvedValue(mockSession());
});

// ── Contacts ─────────────────────────────────────────────

describe('GET /api/contacts', () => {
  it('returns user contacts', async () => {
    const agent = buildMockAgent();
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact-1', userId: TEST_USER.id, agentId: agent.id, agent, createdAt: new Date() },
    ]);

    const req = buildRequest('GET', '/api/contacts');
    const res = await listContacts();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await listContacts();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/contacts', () => {
  it('adds agent to contacts', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.contact.upsert.mockResolvedValue({
      id: 'contact-1',
      userId: TEST_USER.id,
      agentId: agent.id,
      agent,
    });

    const req = buildRequest('POST', '/api/contacts', {
      body: { agentId: agent.id },
    });
    const res = await addContact(req);

    expect(res.status).toBe(201);
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/contacts', {
      body: { agentId: 'nonexistent' },
    });
    const res = await addContact(req);

    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/contacts', {
      body: { agentId: 'some-id' },
    });
    const res = await addContact(req);

    expect(res.status).toBe(401);
  });
});

// ── Blocks ───────────────────────────────────────────────

describe('GET /api/blocks', () => {
  it('returns user blocks', async () => {
    mockPrisma.block.findMany.mockResolvedValue([
      { id: 'block-1', userId: TEST_USER.id, blockedAgentId: 'agent-1', reason: 'spam' },
    ]);

    const res = await listBlocks();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await listBlocks();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/blocks', () => {
  it('blocks an agent', async () => {
    mockPrisma.block.upsert.mockResolvedValue({
      id: 'block-1',
      userId: TEST_USER.id,
      blockedAgentId: 'agent-1',
      reason: 'spam',
    });

    const req = buildRequest('POST', '/api/blocks', {
      body: { agentId: 'agent-1', reason: 'spam' },
    });
    const res = await addBlock(req);

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.blocked).toBe(1);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/blocks', {
      body: { agentId: 'agent-1' },
    });
    const res = await addBlock(req);

    expect(res.status).toBe(401);
  });
});
