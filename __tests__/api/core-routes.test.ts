/**
 * Integration tests for /api/nations, /api/contacts, /api/blocks,
 * /api/agents/mine, /api/agents/:id/settings, /api/credits routes.
 *
 * Covers: auth, CRUD, validation, edge cases.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  TEST_USER,
  TEST_ADMIN,
  TEST_NATION,
  buildRequest,
  buildMockAgent,
  mockSession,
  resetAgentCounter,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  nation: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
  contact: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  block: {
    findMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  creditTransaction: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));

jest.mock('@/lib/presence', () => ({
  isOnline: jest.fn().mockReturnValue(false),
}));

const mockCanCreateNation = jest.fn();
const mockDeductNationCreationCredits = jest.fn();
jest.mock('@/lib/services/credits', () => ({
  ...jest.requireActual('@/lib/services/credits'),
  canCreateNation: (...args: any[]) => mockCanCreateNation(...args),
  deductNationCreationCredits: (...args: any[]) => mockDeductNationCreationCredits(...args),
}));

// ── Import routes ────────────────────────────────────────

import { GET as listNations, POST as createNation } from '../../app/api/nations/route';
import { GET as listContacts, POST as addContact } from '../../app/api/contacts/route';
import { DELETE as removeContact } from '../../app/api/contacts/[agentId]/route';
import { GET as listBlocks, POST as addBlock } from '../../app/api/blocks/route';
import { DELETE as removeBlock } from '../../app/api/blocks/[agentId]/route';
import { GET as getMyAgents } from '../../app/api/agents/mine/route';
import { GET as getAgentSettings } from '../../app/api/agents/[id]/settings/route';
import { GET as getCredits } from '../../app/api/credits/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  resetAgentCounter();
  mockGetServerSession.mockResolvedValue(mockSession());
  mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, credits: 10000 });
  mockCanCreateNation.mockResolvedValue({ ok: true });
  mockDeductNationCreationCredits.mockResolvedValue({ ok: true, balance: 9500 });
});

// ── Nations ──────────────────────────────────────────────

describe('GET /api/nations', () => {
  it('returns list of nations', async () => {
    mockPrisma.nation.findMany.mockResolvedValue([
      { ...TEST_NATION, _count: { agents: 5 } },
    ]);

    const req = buildRequest('GET', '/api/nations');
    const res = await listNations(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0].code).toBe('MOLT');
  });

  it('filters by search query', async () => {
    mockPrisma.nation.findMany.mockResolvedValue([]);

    const req = buildRequest('GET', '/api/nations', { searchParams: { q: 'solar' } });
    await listNations(req);

    const call = mockPrisma.nation.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
  });

  it('only returns active nations', async () => {
    mockPrisma.nation.findMany.mockResolvedValue([]);

    const req = buildRequest('GET', '/api/nations');
    await listNations(req);

    const call = mockPrisma.nation.findMany.mock.calls[0][0];
    expect(call.where.isActive).toBe(true);
  });
});

describe('POST /api/nations', () => {
  const validBody = { code: 'SOLR', displayName: 'Solar', description: 'A solar nation' };

  it('creates a new nation with provisional status', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(null);
    mockPrisma.nation.create.mockResolvedValue({
      ...validBody,
      ownerId: TEST_USER.id,
      provisionalUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      _count: { agents: 0 },
    });

    const req = buildRequest('POST', '/api/nations', { body: validBody });
    const res = await createNation(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.creditsDeducted).toBe(500);
    expect(body.creditsRemaining).toBe(9500);
  });

  it('rejects unauthenticated requests', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('POST', '/api/nations', { body: validBody });
    const res = await createNation(req);
    expect(res.status).toBe(401);
  });

  it('rejects MOLT (reserved)', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { ...validBody, code: 'MOLT' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reserved/i);
  });

  it('rejects TEST (reserved)', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { ...validBody, code: 'TEST' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
  });

  it('rejects NULL (reserved)', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { ...validBody, code: 'NULL' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
  });

  it('rejects VOID (reserved)', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { ...validBody, code: 'VOID' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
  });

  it('requires description', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { code: 'SOLR', displayName: 'Solar' }, // no description
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
  });

  it('rejects when canCreateNation fails (quota/cooldown/credits/email)', async () => {
    mockCanCreateNation.mockResolvedValue({ ok: false, reason: 'Nation limit reached (3 nations).' });

    const req = buildRequest('POST', '/api/nations', { body: validBody });
    const res = await createNation(req);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/limit/i);
  });

  it('rejects when credit deduction fails', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(null);
    const createdNation = { id: 'new-nation-id', ...validBody, ownerId: TEST_USER.id };
    mockPrisma.nation.create.mockResolvedValue(createdNation);
    mockDeductNationCreationCredits.mockResolvedValue({ ok: false, balance: 100 });
    (mockPrisma.nation as any).delete = jest.fn().mockResolvedValue({});

    const req = buildRequest('POST', '/api/nations', { body: validBody });
    const res = await createNation(req);
    expect(res.status).toBe(402);
  });

  it('rejects duplicate nation code', async () => {
    mockPrisma.nation.findUnique.mockResolvedValue(TEST_NATION);

    const req = buildRequest('POST', '/api/nations', {
      body: { ...validBody, code: 'CLAW' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(409);
  });

  it('rejects invalid nation code format', async () => {
    const req = buildRequest('POST', '/api/nations', {
      body: { code: 'ab', displayName: 'Bad', description: 'Bad nation' },
    });
    const res = await createNation(req);
    expect(res.status).toBe(400);
  });
});

// ── Favorites ────────────────────────────────────────────

describe('GET /api/contacts', () => {
  it('returns user contacts', async () => {
    mockPrisma.contact.findMany.mockResolvedValue([
      { id: 'contact-1', agentId: 'agent-1', agent: buildMockAgent() },
    ]);

    const req = buildRequest('GET', '/api/contacts');
    const res = await listContacts();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await listContacts();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/contacts', () => {
  it('adds a contact', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);
    mockPrisma.contact.upsert.mockResolvedValue({ id: 'contact-1', agentId: agent.id, agent });

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
});

describe('DELETE /api/contacts/:agentId', () => {
  it('removes a contact', async () => {
    mockPrisma.contact.delete.mockResolvedValue({});

    const req = buildRequest('DELETE', '/api/contacts/agent-1');
    const res = await removeContact(req, { params: Promise.resolve({ agentId: 'agent-1' }) });

    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('DELETE', '/api/contacts/agent-1');
    const res = await removeContact(req, { params: Promise.resolve({ agentId: 'agent-1' }) });
    expect(res.status).toBe(401);
  });
});

// ── Blocks ───────────────────────────────────────────────

describe('GET /api/blocks', () => {
  it('returns user blocks', async () => {
    mockPrisma.block.findMany.mockResolvedValue([
      { id: 'block-1', blockedAgentId: 'agent-1', blockedAgent: buildMockAgent() },
    ]);

    const res = await listBlocks();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await listBlocks();
    expect(res.status).toBe(401);
  });
});

describe('POST /api/blocks', () => {
  it('blocks an agent', async () => {
    mockPrisma.block.upsert.mockResolvedValue({ id: 'block-1', blockedAgentId: 'agent-1' });

    const req = buildRequest('POST', '/api/blocks', {
      body: { agentId: 'agent-1' },
    });
    const res = await addBlock(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.blocked).toBe(1);
  });
});

describe('DELETE /api/blocks/:agentId', () => {
  it('removes a block', async () => {
    mockPrisma.block.delete.mockResolvedValue({});

    const req = buildRequest('DELETE', '/api/blocks/agent-1');
    const res = await removeBlock(req, { params: Promise.resolve({ agentId: 'agent-1' }) });

    expect(res.status).toBe(200);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('DELETE', '/api/blocks/agent-1');
    const res = await removeBlock(req, { params: Promise.resolve({ agentId: 'agent-1' }) });
    expect(res.status).toBe(401);
  });
});

// ── My Agents ────────────────────────────────────────────

describe('GET /api/agents/mine', () => {
  it('returns agents owned by current user', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findMany.mockResolvedValue([agent]);

    const res = await getMyAgents();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
  });

  it('strips sensitive fields', async () => {
    const agent = buildMockAgent({ endpointUrl: 'https://secret.example.com' });
    mockPrisma.agent.findMany.mockResolvedValue([agent]);

    const res = await getMyAgents();
    const body = await res.json();

    expect(body[0].endpointUrl).toBeUndefined();
    expect(body[0].publicKey).toBeUndefined();
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const res = await getMyAgents();
    expect(res.status).toBe(401);
  });
});

// ── Agent Settings ───────────────────────────────────────

describe('GET /api/agents/:id/settings', () => {
  it('returns full settings for owner', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/api/agents/${agent.id}/settings`);
    const res = await getAgentSettings(req, { params: Promise.resolve({ id: agent.id }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.displayName).toBe(agent.displayName);
    // Settings view includes endpointUrl
    expect(body.endpointUrl).toBeDefined();
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/agents/some-id/settings');
    const res = await getAgentSettings(req, { params: Promise.resolve({ id: 'some-id' }) });
    expect(res.status).toBe(401);
  });

  it('rejects non-owner', async () => {
    const agent = buildMockAgent({ ownerId: 'other-user' });
    mockPrisma.agent.findUnique.mockResolvedValue(agent);

    const req = buildRequest('GET', `/api/agents/${agent.id}/settings`);
    const res = await getAgentSettings(req, { params: Promise.resolve({ id: agent.id }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 for non-existent agent', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/agents/nonexistent/settings');
    const res = await getAgentSettings(req, { params: Promise.resolve({ id: 'nonexistent' }) });
    expect(res.status).toBe(404);
  });
});

// ── Credits ──────────────────────────────────────────────

describe('GET /api/credits', () => {
  it('returns balance and transaction history', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_USER.id, credits: 5000 });
    mockPrisma.creditTransaction.findMany.mockResolvedValue([
      { id: 'tx-1', amount: 10000, type: 'signup_grant', balance: 10000 },
    ]);

    const req = buildRequest('GET', '/api/credits');
    const res = await getCredits(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.balance).toBe(5000);
    expect(body.transactions).toHaveLength(1);
  });

  it('rejects unauthenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const req = buildRequest('GET', '/api/credits');
    const res = await getCredits(req);
    expect(res.status).toBe(401);
  });
});
