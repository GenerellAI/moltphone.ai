/**
 * Integration tests for /api/auth/register route.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildRequest } from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
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

import { POST as register } from '../../app/api/auth/register/route';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/auth/register', () => {
  it('creates a new user with signup credits', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null); // no existing user
    mockPrisma.user.create.mockResolvedValue({
      id: 'new-user-id',
      email: 'new@example.com',
      name: 'New User',
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
    expect(body.credits).toBe(10000);
    expect(mockGrantSignupCredits).toHaveBeenCalledWith('new-user-id');
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
    mockPrisma.user.create.mockResolvedValue({ id: 'uid', email: 'a@b.com', name: null });

    const req = buildRequest('POST', '/api/auth/register', {
      body: { email: 'a@b.com', password: 'securepassword' },
    });
    await register(req);

    expect(bcrypt.hash).toHaveBeenCalledWith('securepassword', 10);
    expect(mockPrisma.user.create.mock.calls[0][0].data.passwordHash).toBe('$2a$10$hashed');
  });
});
