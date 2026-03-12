/**
 * Tests for the MoltNumber Registry service and API routes.
 *
 * Tests: carrier registration, number binding/unbinding, lookup,
 * nation binding, self-registration, cross-carrier routing proxy,
 * and registry API endpoints.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest, TEST_ADMIN, TEST_USER, mockSession, buildMockAgent } from './helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  registryCarrier: {
    upsert: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  registryNumberBinding: {
    upsert: jest.fn(),
    deleteMany: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  registryNationBinding: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  nation: {
    findMany: jest.fn(),
  },
  agent: {
    findMany: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
};

jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({
  authOptions: {},
}));

import { getServerSession } from 'next-auth';
const mockGetServerSession = getServerSession as jest.Mock;

// ── Registry Service Tests ───────────────────────────────

import {
  registerCarrier,
  getCarrier,
  listCarriers,
  bindNumber,
  unbindNumber,
  lookupNumber,
  bindNation,
  getNationCarriers,
  selfRegister,
  getCarrierDomain,
} from '../lib/services/registry';

describe('Registry Service — registerCarrier', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts a carrier by domain', async () => {
    const carrier = { id: 'c1', domain: 'moltphone.ai', publicKey: 'pk1', callBaseUrl: 'https://moltphone.ai/call', status: 'active' };
    mockPrisma.registryCarrier.upsert.mockResolvedValue(carrier);

    const result = await registerCarrier({
      domain: 'moltphone.ai',
      publicKey: 'pk1',
      callBaseUrl: 'https://moltphone.ai/call',
    });

    expect(result).toEqual(carrier);
    expect(mockPrisma.registryCarrier.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { domain: 'moltphone.ai' },
        create: expect.objectContaining({ domain: 'moltphone.ai' }),
      }),
    );
  });
});

describe('Registry Service — bindNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  it('binds a number to a carrier', async () => {
    const carrier = { id: 'c1', domain: 'moltphone.ai', status: 'active' };
    const binding = { id: 'b1', moltNumber: 'MOLT-1234-5678-9ABC', carrierId: 'c1', nationCode: 'MOLT', carrier };
    mockPrisma.registryCarrier.findUnique.mockResolvedValue(carrier);
    mockPrisma.registryNumberBinding.upsert.mockResolvedValue(binding);

    const result = await bindNumber({
      moltNumber: 'MOLT-1234-5678-9ABC',
      carrierDomain: 'moltphone.ai',
      nationCode: 'MOLT',
    });

    expect(result).toEqual(binding);
  });

  it('throws if carrier not found', async () => {
    mockPrisma.registryCarrier.findUnique.mockResolvedValue(null);

    await expect(bindNumber({
      moltNumber: 'MOLT-1234-5678-9ABC',
      carrierDomain: 'unknown.example.com',
      nationCode: 'MOLT',
    })).rejects.toThrow('Carrier not found or inactive: unknown.example.com');
  });
});

describe('Registry Service — unbindNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the binding', async () => {
    mockPrisma.registryNumberBinding.deleteMany.mockResolvedValue({ count: 1 });

    await unbindNumber('MOLT-1234-5678-9ABC');

    expect(mockPrisma.registryNumberBinding.deleteMany).toHaveBeenCalledWith({
      where: { moltNumber: 'MOLT-1234-5678-9ABC' },
    });
  });
});

describe('Registry Service — lookupNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns carrier info for a bound number', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue({
      moltNumber: 'MOLT-AAAA-BBBB-CCCC',
      nationCode: 'MOLT',
      carrier: {
        domain: 'moltphone.ai',
        callBaseUrl: 'https://moltphone.ai/call',
        publicKey: 'pk1',
        status: 'active',
      },
    });

    const result = await lookupNumber('MOLT-AAAA-BBBB-CCCC');

    expect(result).toEqual({
      moltNumber: 'MOLT-AAAA-BBBB-CCCC',
      nationCode: 'MOLT',
      carrier: {
        domain: 'moltphone.ai',
        callBaseUrl: 'https://moltphone.ai/call',
        publicKey: 'pk1',
      },
    });
  });

  it('returns null for unbound number', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue(null);

    const result = await lookupNumber('MOLT-XXXX-XXXX-XXXX');
    expect(result).toBeNull();
  });

  it('returns null for suspended carrier', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue({
      moltNumber: 'MOLT-AAAA-BBBB-CCCC',
      nationCode: 'MOLT',
      carrier: {
        domain: 'bad-carrier.example.com',
        callBaseUrl: 'https://bad-carrier.example.com/call',
        publicKey: 'pk1',
        status: 'suspended',
      },
    });

    const result = await lookupNumber('MOLT-AAAA-BBBB-CCCC');
    expect(result).toBeNull();
  });
});

describe('Registry Service — bindNation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('binds a nation to a carrier', async () => {
    const carrier = { id: 'c1', domain: 'moltphone.ai', status: 'active' };
    const binding = { id: 'nb1', nationCode: 'MOLT', carrierId: 'c1', isPrimary: true, carrier };
    mockPrisma.registryCarrier.findUnique.mockResolvedValue(carrier);
    mockPrisma.registryNationBinding.upsert.mockResolvedValue(binding);

    const result = await bindNation({
      nationCode: 'MOLT',
      carrierDomain: 'moltphone.ai',
      isPrimary: true,
    });

    expect(result).toEqual(binding);
  });
});

describe('Registry Service — selfRegister', () => {
  beforeEach(() => jest.clearAllMocks());

  it('registers carrier, nations, and agent numbers', async () => {
    const carrier = { id: 'c1', domain: 'moltphone.ai', status: 'active' };
    mockPrisma.registryCarrier.upsert.mockResolvedValue(carrier);
    mockPrisma.registryCarrier.findUnique.mockResolvedValue(carrier);
    mockPrisma.nation.findMany.mockResolvedValue([
      { code: 'MOLT', type: 'open' },
      { code: 'SOLR', type: 'carrier' },
    ]);
    mockPrisma.agent.findMany.mockResolvedValue([
      { moltNumber: 'MOLT-1111-2222-3333', nationCode: 'MOLT' },
      { moltNumber: 'SOLR-AAAA-BBBB-CCCC', nationCode: 'SOLR' },
    ]);
    mockPrisma.registryNationBinding.upsert.mockResolvedValue({});
    mockPrisma.registryNumberBinding.upsert.mockResolvedValue({});

    const result = await selfRegister();

    expect(result.carrier).toEqual(carrier);
    expect(result.nationsRegistered).toBe(2);
    expect(result.numbersRegistered).toBe(2);
    expect(mockPrisma.registryNationBinding.upsert).toHaveBeenCalledTimes(2);
    expect(mockPrisma.registryNumberBinding.upsert).toHaveBeenCalledTimes(2);
  });
});

describe('Registry Service — getCarrierDomain', () => {
  it('returns default domain when env not set', () => {
    delete process.env.CARRIER_DOMAIN;
    expect(getCarrierDomain()).toBe('moltphone.ai');
  });
});

// ── Registry API Route Tests ─────────────────────────────

describe('GET /api/registry/carriers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns list of active carriers', async () => {
    const carriers = [
      { id: 'c1', domain: 'moltphone.ai', callBaseUrl: 'https://moltphone.ai/call', status: 'active' },
    ];
    mockPrisma.registryCarrier.findMany.mockResolvedValue(carriers);

    const { GET } = await import('../app/api/registry/carriers/route');
    const req = buildRequest('GET', '/api/registry/carriers');
    const res = await GET(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.carriers).toEqual(carriers);
  });
});

describe('POST /api/registry/carriers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires admin auth', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import('../app/api/registry/carriers/route');
    const req = buildRequest('POST', '/api/registry/carriers', {
      body: { domain: 'new.example.com', publicKey: 'pk', callBaseUrl: 'https://new.example.com/call' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });

  it('registers a carrier when admin', async () => {
    mockGetServerSession.mockResolvedValue(mockSession(TEST_ADMIN));
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_ADMIN.id, role: 'admin' });

    const carrier = { id: 'c2', domain: 'new.example.com', publicKey: 'pk', callBaseUrl: 'https://new.example.com/call', status: 'active' };
    mockPrisma.registryCarrier.upsert.mockResolvedValue(carrier);

    const { POST } = await import('../app/api/registry/carriers/route');
    const req = buildRequest('POST', '/api/registry/carriers', {
      body: { domain: 'new.example.com', publicKey: 'pk', callBaseUrl: 'https://new.example.com/call' },
    });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.carrier.domain).toBe('new.example.com');
  });
});

describe('GET /api/registry/lookup/:moltNumber', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 for unbound number', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue(null);

    const { GET } = await import('../app/api/registry/lookup/[moltNumber]/route');
    const req = buildRequest('GET', '/api/registry/lookup/MOLT-XXXX-XXXX-XXXX');
    const res = await GET(req, { params: Promise.resolve({ moltNumber: 'MOLT-XXXX-XXXX-XXXX' }) });

    expect(res.status).toBe(404);
  });

  it('returns carrier info for bound number', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue({
      moltNumber: 'MOLT-AAAA-BBBB-CCCC',
      nationCode: 'MOLT',
      carrier: {
        domain: 'moltphone.ai',
        callBaseUrl: 'https://moltphone.ai/call',
        publicKey: 'pk1',
        status: 'active',
      },
    });

    const { GET } = await import('../app/api/registry/lookup/[moltNumber]/route');
    const req = buildRequest('GET', '/api/registry/lookup/MOLT-AAAA-BBBB-CCCC');
    const res = await GET(req, { params: Promise.resolve({ moltNumber: 'MOLT-AAAA-BBBB-CCCC' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.carrier.domain).toBe('moltphone.ai');
  });
});

describe('POST /api/registry/bind', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires admin auth', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import('../app/api/registry/bind/route');
    const req = buildRequest('POST', '/api/registry/bind', {
      body: { moltNumber: 'MOLT-1234-5678-9ABC', carrierDomain: 'moltphone.ai', nationCode: 'MOLT' },
    });
    const res = await POST(req);

    expect(res.status).toBe(401);
  });
});

describe('POST /api/registry/self-register', () => {
  beforeEach(() => jest.clearAllMocks());

  it('requires admin auth', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const { POST } = await import('../app/api/registry/self-register/route');
    const res = await POST();

    expect(res.status).toBe(401);
  });

  it('self-registers carrier, nations, numbers', async () => {
    mockGetServerSession.mockResolvedValue(mockSession(TEST_ADMIN));
    mockPrisma.user.findUnique.mockResolvedValue({ id: TEST_ADMIN.id, role: 'admin' });

    const carrier = { id: 'c1', domain: 'moltphone.ai', status: 'active' };
    mockPrisma.registryCarrier.upsert.mockResolvedValue(carrier);
    mockPrisma.registryCarrier.findUnique.mockResolvedValue(carrier);
    mockPrisma.nation.findMany.mockResolvedValue([{ code: 'MOLT', type: 'open' }]);
    mockPrisma.agent.findMany.mockResolvedValue([{ moltNumber: 'MOLT-1111-2222-3333', nationCode: 'MOLT' }]);
    mockPrisma.registryNationBinding.upsert.mockResolvedValue({});
    mockPrisma.registryNumberBinding.upsert.mockResolvedValue({});

    const { POST } = await import('../app/api/registry/self-register/route');
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.nationsRegistered).toBe(1);
    expect(json.numbersRegistered).toBe(1);
  });
});

// ── Cross-Carrier Routing Tests ──────────────────────────

describe('Cross-carrier call routing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null for number not in registry', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue(null);

    const result = await lookupNumber('CLAW-XXXX-YYYY-ZZZZ');
    expect(result).toBeNull();
  });

  it('returns carrier info for remote number', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue({
      moltNumber: 'CLAW-AAAA-BBBB-CCCC',
      nationCode: 'CLAW',
      carrier: {
        domain: 'clawcarrier.example.com',
        callBaseUrl: 'https://clawcarrier.example.com/call',
        publicKey: 'remote-pk',
        status: 'active',
      },
    });

    const result = await lookupNumber('CLAW-AAAA-BBBB-CCCC');
    expect(result).not.toBeNull();
    expect(result!.carrier.domain).toBe('clawcarrier.example.com');
  });
});
