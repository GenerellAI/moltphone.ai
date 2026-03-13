/**
 * Tests for the remote registry client and dual-mode dispatch.
 *
 * Tests that when REGISTRY_MODE=remote, the registry service delegates
 * to the HTTP client, and that the HTTP client constructs correct requests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mocks ────────────────────────────────────────────────

// Mock carrier.config BEFORE importing anything that depends on it
let mockRegistryMode = 'remote';
jest.mock('@/carrier.config', () => ({
  get REGISTRY_MODE() { return mockRegistryMode; },
  REGISTRY_URL: 'https://registry.test',
}));

// Mock prisma
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
  },
  registryNationBinding: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
  nation: { findMany: jest.fn() },
  agent: { findMany: jest.fn() },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock global fetch for the HTTP client
const mockFetch = jest.fn();
global.fetch = mockFetch as any;

// ── Imports ──────────────────────────────────────────────

import {
  remoteListCarriers,
  remoteGetCarrier,
  remoteLookupNumber,
  remoteGetNationCarriers,
  remoteRegisterCarrier,
  remoteBindNumber,
  remoteUnbindNumber,
  remoteBindNation,
} from '../lib/services/registry-client';

import {
  registerCarrier,
  getCarrier,
  listCarriers,
  bindNumber,
  unbindNumber,
  lookupNumber,
  bindNation,
  getNationCarriers,
} from '../lib/services/registry';

// ── Helper ───────────────────────────────────────────────

function mockResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(data),
    text: jest.fn().mockResolvedValue(JSON.stringify(data)),
  };
}

// ── Remote Client Tests ──────────────────────────────────

describe('Registry HTTP Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Ensure no CARRIER_PRIVATE_KEY so dev-mode headers are used
    delete process.env.CARRIER_PRIVATE_KEY;
  });

  describe('remoteListCarriers', () => {
    it('fetches carriers from registry', async () => {
      const carriers = [{ domain: 'a.com' }, { domain: 'b.com' }];
      mockFetch.mockResolvedValue(mockResponse({ carriers }));

      const result = await remoteListCarriers();

      expect(result).toEqual(carriers);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test/api/registry/carriers',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('throws on non-OK response', async () => {
      mockFetch.mockResolvedValue(mockResponse({}, 500));
      await expect(remoteListCarriers()).rejects.toThrow('listCarriers failed: 500');
    });
  });

  describe('remoteGetCarrier', () => {
    it('fetches a carrier by domain', async () => {
      const carrier = { domain: 'moltphone.ai', publicKey: 'pk1' };
      mockFetch.mockResolvedValue(mockResponse({ carrier }));

      const result = await remoteGetCarrier('moltphone.ai');

      expect(result).toEqual(carrier);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test/api/registry/carriers?domain=moltphone.ai',
        expect.any(Object),
      );
    });

    it('returns null when carrier not found', async () => {
      mockFetch.mockResolvedValue(mockResponse({ carrier: null }));
      const result = await remoteGetCarrier('unknown.com');
      expect(result).toBeNull();
    });
  });

  describe('remoteLookupNumber', () => {
    it('resolves a MoltNumber to carrier info', async () => {
      const data = {
        moltNumber: 'MPHO-1234-5678-9ABC',
        nationCode: 'MPHO',
        carrier: { domain: 'moltphone.ai', callBaseUrl: 'https://call.moltphone.ai' },
      };
      mockFetch.mockResolvedValue(mockResponse(data));

      const result = await remoteLookupNumber('MPHO-1234-5678-9ABC');

      expect(result).toEqual(data);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://registry.test/api/registry/lookup/MPHO-1234-5678-9ABC',
        expect.any(Object),
      );
    });

    it('returns null for 404', async () => {
      mockFetch.mockResolvedValue(mockResponse({ error: 'not found' }, 404));
      const result = await remoteLookupNumber('XXXX-0000-0000-0000');
      expect(result).toBeNull();
    });
  });

  describe('remoteRegisterCarrier', () => {
    it('sends carrier data with auth headers', async () => {
      const carrier = { domain: 'test.com', publicKey: 'pk' };
      mockFetch.mockResolvedValue(mockResponse({ carrier }));

      const result = await remoteRegisterCarrier({
        domain: 'test.com',
        publicKey: 'pk',
        callBaseUrl: 'https://test.com/call',
      });

      expect(result).toEqual(carrier);
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe('POST');
      expect(opts.headers).toHaveProperty('X-Registry-Carrier');
    });

    it('throws on failure with body', async () => {
      mockFetch.mockResolvedValue(mockResponse({ error: 'bad' }, 400));
      await expect(
        remoteRegisterCarrier({ domain: 'x', publicKey: 'y', callBaseUrl: 'z' }),
      ).rejects.toThrow('registerCarrier failed: 400');
    });
  });

  describe('remoteBindNumber', () => {
    it('binds a number via POST', async () => {
      const binding = { moltNumber: 'MPHO-AAAA-BBBB-CCCC' };
      mockFetch.mockResolvedValue(mockResponse({ binding }));

      const result = await remoteBindNumber({
        moltNumber: 'MPHO-AAAA-BBBB-CCCC',
        carrierDomain: 'test.com',
        nationCode: 'MPHO',
      });

      expect(result).toEqual(binding);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('https://registry.test/api/registry/bind');
      expect(opts.method).toBe('POST');
    });
  });

  describe('remoteUnbindNumber', () => {
    it('unbinds via DELETE', async () => {
      mockFetch.mockResolvedValue(mockResponse({ ok: true }));
      const result = await remoteUnbindNumber('MPHO-AAAA-BBBB-CCCC');
      expect(result).toEqual({ count: 1 });
      const [, opts] = mockFetch.mock.calls[0];
      expect(opts.method).toBe('DELETE');
    });
  });

  describe('remoteBindNation', () => {
    it('binds a nation via POST to /nations', async () => {
      const binding = { nationCode: 'MPHO' };
      mockFetch.mockResolvedValue(mockResponse({ binding }));

      const result = await remoteBindNation({
        nationCode: 'MPHO',
        carrierDomain: 'test.com',
      });

      expect(result).toEqual(binding);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('https://registry.test/api/registry/nations');
    });
  });

  describe('remoteGetNationCarriers', () => {
    it('fetches nation carriers', async () => {
      const bindings = [{ nationCode: 'MPHO', carrier: { domain: 'a.com' } }];
      mockFetch.mockResolvedValue(mockResponse({ carriers: bindings }));

      const result = await remoteGetNationCarriers('MPHO');

      // Should extract from carriers or nations key
      expect(result).toEqual(bindings);
    });
  });
});

// ── Dual-Mode Dispatch Tests ─────────────────────────────

describe('Registry dual-mode dispatch (REGISTRY_MODE=remote)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistryMode = 'remote';
    delete process.env.CARRIER_PRIVATE_KEY;
  });

  afterAll(() => {
    mockRegistryMode = 'local';
  });

  it('registerCarrier delegates to remote', async () => {
    const carrier = { domain: 'test.com', publicKey: 'pk' };
    mockFetch.mockResolvedValue(mockResponse({ carrier }));

    const result = await registerCarrier({
      domain: 'test.com',
      publicKey: 'pk',
      callBaseUrl: 'https://test.com/call',
    });

    expect(result).toEqual(carrier);
    expect(mockPrisma.registryCarrier.upsert).not.toHaveBeenCalled();
  });

  it('getCarrier delegates to remote', async () => {
    const carrier = { domain: 'moltphone.ai' };
    mockFetch.mockResolvedValue(mockResponse({ carrier }));

    const result = await getCarrier('moltphone.ai');

    expect(result).toEqual(carrier);
    expect(mockPrisma.registryCarrier.findUnique).not.toHaveBeenCalled();
  });

  it('listCarriers delegates to remote', async () => {
    const carriers = [{ domain: 'a.com' }];
    mockFetch.mockResolvedValue(mockResponse({ carriers }));

    const result = await listCarriers();

    expect(result).toEqual(carriers);
    expect(mockPrisma.registryCarrier.findMany).not.toHaveBeenCalled();
  });

  it('lookupNumber delegates to remote', async () => {
    const data = { moltNumber: 'MPHO-1111-2222-3333', carrier: { domain: 'a.com' } };
    mockFetch.mockResolvedValue(mockResponse(data));

    const result = await lookupNumber('MPHO-1111-2222-3333');

    expect(result).toEqual(data);
    expect(mockPrisma.registryNumberBinding.findUnique).not.toHaveBeenCalled();
  });

  it('lookupNumber returns null for 404', async () => {
    mockFetch.mockResolvedValue(mockResponse({}, 404));

    const result = await lookupNumber('XXXX-0000-0000-0000');

    expect(result).toBeNull();
    expect(mockPrisma.registryNumberBinding.findUnique).not.toHaveBeenCalled();
  });

  it('bindNumber delegates to remote', async () => {
    const binding = { moltNumber: 'MPHO-AAAA-BBBB-CCCC' };
    mockFetch.mockResolvedValue(mockResponse({ binding }));

    const result = await bindNumber({
      moltNumber: 'MPHO-AAAA-BBBB-CCCC',
      carrierDomain: 'test.com',
      nationCode: 'MPHO',
    });

    expect(result).toEqual(binding);
    expect(mockPrisma.registryCarrier.findUnique).not.toHaveBeenCalled();
  });

  it('unbindNumber delegates to remote', async () => {
    mockFetch.mockResolvedValue(mockResponse({ ok: true }));

    const result = await unbindNumber('MPHO-AAAA-BBBB-CCCC');

    expect(result).toEqual({ count: 1 });
    expect(mockPrisma.registryNumberBinding.deleteMany).not.toHaveBeenCalled();
  });

  it('bindNation delegates to remote', async () => {
    const binding = { nationCode: 'MPHO' };
    mockFetch.mockResolvedValue(mockResponse({ binding }));

    const result = await bindNation({
      nationCode: 'MPHO',
      carrierDomain: 'test.com',
    });

    expect(result).toEqual(binding);
    expect(mockPrisma.registryCarrier.findUnique).not.toHaveBeenCalled();
  });

  it('getNationCarriers delegates to remote', async () => {
    const bindings = [{ nationCode: 'MPHO' }];
    mockFetch.mockResolvedValue(mockResponse({ carriers: bindings }));

    const result = await getNationCarriers('MPHO');

    expect(result).toEqual(bindings);
    expect(mockPrisma.registryNationBinding.findMany).not.toHaveBeenCalled();
  });
});

describe('Registry dual-mode dispatch (REGISTRY_MODE=local)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRegistryMode = 'local';
  });

  it('registerCarrier uses Prisma directly', async () => {
    const carrier = { id: 'c1', domain: 'test.com' };
    mockPrisma.registryCarrier.upsert.mockResolvedValue(carrier);

    const result = await registerCarrier({
      domain: 'test.com',
      publicKey: 'pk',
      callBaseUrl: 'https://test.com/call',
    });

    expect(result).toEqual(carrier);
    expect(mockPrisma.registryCarrier.upsert).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('lookupNumber uses Prisma directly', async () => {
    mockPrisma.registryNumberBinding.findUnique.mockResolvedValue({
      moltNumber: 'MPHO-AAAA-BBBB-CCCC',
      nationCode: 'MPHO',
      carrier: {
        domain: 'moltphone.ai',
        callBaseUrl: 'https://moltphone.ai/call',
        publicKey: 'pk1',
        status: 'active',
      },
    });

    const result = await lookupNumber('MPHO-AAAA-BBBB-CCCC');

    expect(result).toBeTruthy();
    expect(mockPrisma.registryNumberBinding.findUnique).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('listCarriers uses Prisma directly', async () => {
    mockPrisma.registryCarrier.findMany.mockResolvedValue([]);
    await listCarriers();
    expect(mockPrisma.registryCarrier.findMany).toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
