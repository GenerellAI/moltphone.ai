/**
 * Integration tests for /api/auth/register route.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  agent: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock credits service
const mockGrantSignupCredits = jest.fn().mockResolvedValue(10000);
jest.mock('@/lib/services/credits', () => ({
  grantSignupCredits: (...args: any[]) => mockGrantSignupCredits(...args),
  SIGNUP_CREDITS: 10000,
}));

// Mock bcryptjs
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$hashed'),
  compare: jest.fn(),
}));

// Mock ed25519
jest.mock('@/lib/ed25519', () => ({
  generateKeyPair: jest.fn().mockReturnValue({
    publicKey: 'mock-public-key',
    privateKey: 'mock-private-key',
  }),
}));

// Mock MoltNumber
jest.mock('@/lib/molt-number', () => ({
  generateMoltNumber: jest.fn().mockReturnValue('MPHO-AAAA-BBBB-CCCC-DDDD'),
}));

// Mock email (verification)
jest.mock('@/lib/email', () => ({
  generateVerificationToken: jest.fn().mockReturnValue('mock-verification-token'),
  sendVerificationEmail: jest.fn().mockResolvedValue(undefined),
  VERIFICATION_TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000,
}));

// Mock rate limiter — always allow
jest.mock('@/lib/rate-limit', () => ({
  rateLimit: jest.fn().mockResolvedValue({ ok: true, remaining: 99 }),
}));

// Mock Turnstile — always pass
jest.mock('@/lib/turnstile', () => ({
  verifyTurnstile: jest.fn().mockResolvedValue({ success: true }),
}));

// Mock carrier identity
jest.mock('@/lib/carrier-identity', () => ({
  issueRegistrationCertificate: jest.fn().mockReturnValue({
    version: '1',
    moltNumber: 'MPHO-AAAA-BBBB-CCCC-DDDD',
    agentPublicKey: 'mock-public-key',
    nationCode: 'MPHO',
    carrierDomain: 'moltphone.ai',
    issuedAt: 1000000,
    signature: 'mock-sig',
  }),
  registrationCertToJSON: jest.fn().mockReturnValue({
    version: '1',
    molt_number: 'MPHO-AAAA-BBBB-CCCC-DDDD',
    agent_public_key: 'mock-public-key',
    nation_code: 'MPHO',
    carrier_domain: 'moltphone.ai',
    issued_at: 1000000,
    signature: 'mock-sig',
  }),
  getCarrierCertificateJSON: jest.fn().mockReturnValue({
    version: '1',
    carrier_domain: 'moltphone.ai',
    carrier_public_key: 'mock-carrier-pub',
    issued_at: 1000000,
    expires_at: 2000000,
    issuer: 'moltprotocol.org',
    signature: 'mock-carrier-sig',
  }),
}));

import { POST as register } from '../../app/api/auth/register/route';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  it('creates a new user with signup credits and personal agent', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user
    mockPrisma.user.findFirst.mockResolvedValue(null); // no name collision
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const txPrisma = {
        user: {
          create: jest.fn().mockResolvedValue({
            id: 'new-user-id',
            email: 'new@example.com',
            name: 'New User',
          }),
          update: jest.fn(),
        },
        agent: {
          create: jest.fn().mockResolvedValue({
            id: 'personal-agent-id',
            moltNumber: 'MPHO-AAAA-BBBB-CCCC-DDDD',
          }),
        },
        emailVerificationToken: {
          create: jest.fn().mockResolvedValue({ id: 'token-id' }),
        },
      };
      return fn(txPrisma);
    });

    const req = buildRequest('POST', '/api/auth/register', {
      body: {
        email: 'new@example.com',
        password: 'password123',
        name: 'New User',
      },
    });
    const res = await register(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.email).toBe('new@example.com');
    expect(body.emailVerified).toBe(false);
    expect(body.personalAgent).toBeDefined();
    expect(body.personalAgent.moltNumber).toBe('MPHO-AAAA-BBBB-CCCC-DDDD');
    expect(body.personalAgent.privateKey).toBe('mock-private-key');
    // Signup credits are NOT granted at registration — they're granted on email verification
  });

  it('rejects duplicate email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing' });

    const req = buildRequest('POST', '/api/auth/register', {
      body: {
        email: 'existing@example.com',
        password: 'password123',
      },
    });
    const res = await register(req);

    expect(res.status).toBe(409);
  });

  it('rejects short password', async () => {
    const req = buildRequest('POST', '/api/auth/register', {
      body: { email: 'test@example.com', password: 'short' },
    });
    const res = await register(req);

    expect(res.status).toBe(400);
  });

  it('rejects invalid email', async () => {
    const req = buildRequest('POST', '/api/auth/register', {
      body: { email: 'not-an-email', password: 'password123' },
    });
    const res = await register(req);

    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const req = buildRequest('POST', '/api/auth/register', {
      body: {},
    });
    const res = await register(req);

    expect(res.status).toBe(400);
  });

  it('hashes password before storing', async () => {
    const bcrypt = require('bcryptjs');
    mockPrisma.user.findUnique.mockResolvedValue(null);
    
    let capturedPasswordHash: string | undefined;
    mockPrisma.$transaction.mockImplementation(async (fn: any) => {
      const txPrisma = {
        user: {
          create: jest.fn().mockImplementation((args: any) => {
            capturedPasswordHash = args.data.passwordHash;
            return { id: 'uid', email: 'a@b.com', name: null };
          }),
          update: jest.fn(),
        },
        agent: {
          create: jest.fn().mockResolvedValue({
            id: 'agent-id',
            moltNumber: 'MPHO-AAAA-BBBB-CCCC-DDDD',
          }),
        },
        emailVerificationToken: {
          create: jest.fn().mockResolvedValue({ id: 'token-id' }),
        },
      };
      return fn(txPrisma);
    });

    const req = buildRequest('POST', '/api/auth/register', {
      body: { email: 'a@b.com', password: 'securepassword' },
    });
    await register(req);

    expect(bcrypt.hash).toHaveBeenCalledWith('securepassword', 10);
    expect(capturedPasswordHash).toBe('$2a$10$hashed');
  });
});
