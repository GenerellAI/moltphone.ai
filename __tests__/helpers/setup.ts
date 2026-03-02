/**
 * Shared test helpers for API integration tests.
 *
 * Provides mock factories for Prisma, NextAuth sessions, and NextRequest objects.
 * Route handlers are imported and called directly — no HTTP server needed.
 */

import { NextRequest } from 'next/server';

// ── Mock session helper ──────────────────────────────────

export interface MockUser {
  id: string;
  email: string;
  name: string;
}

export const TEST_USER: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  name: 'Test User',
};

export const TEST_ADMIN: MockUser = {
  id: 'test-admin-id',
  email: 'admin@example.com',
  name: 'Admin User',
};

export function mockSession(user: MockUser | null = TEST_USER) {
  return user ? { user: { id: user.id, email: user.email, name: user.name } } : null;
}

// ── Request builders ─────────────────────────────────────

const BASE_URL = 'http://localhost:3000';

export function buildRequest(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {},
): NextRequest {
  const url = new URL(path, BASE_URL);
  if (options.searchParams) {
    for (const [k, v] of Object.entries(options.searchParams)) {
      url.searchParams.set(k, v);
    }
  }

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(url, init);
}

// ── Response helpers ─────────────────────────────────────

export async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

// ── Mock nation ──────────────────────────────────────────

export const TEST_NATION = {
  id: 'test-nation-id',
  code: 'MOLT',
  displayName: 'MoltPhone',
  description: 'The default nation',
  badge: '⚡',
  isPublic: true,
  ownerId: TEST_USER.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Mock agent builder ───────────────────────────────────

import { generateKeyPair } from '../../lib/ed25519';
import { generatePhoneNumber } from '../../lib/phone-number';

let agentCounter = 0;

export function buildMockAgent(overrides: Record<string, unknown> = {}) {
  agentCounter++;
  const kp = generateKeyPair();
  const phoneNumber = generatePhoneNumber('MOLT', kp.publicKey);

  return {
    id: `agent-${agentCounter}`,
    phoneNumber,
    nationCode: 'MOLT',
    ownerId: TEST_USER.id,
    displayName: `Test Agent ${agentCounter}`,
    description: 'A test agent',
    avatarUrl: null,
    skills: ['call', 'text'],
    endpointUrl: null,
    dialEnabled: true,
    publicKey: kp.publicKey,
    awayMessage: null,
    directConnectionPolicy: 'direct_on_consent',
    lastSeenAt: null,
    inboundPolicy: 'public',
    allowlistAgentIds: [],
    dndEnabled: false,
    maxConcurrentCalls: 3,
    callForwardingEnabled: false,
    forwardToAgentId: null,
    forwardCondition: 'when_offline',
    webhookFailures: 0,
    isDegraded: false,
    circuitOpenUntil: null,
    pushEndpointUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    nation: { code: 'MOLT', displayName: 'MoltPhone', badge: '⚡' },
    owner: { id: TEST_USER.id, name: 'Test User' },
    _keyPair: kp, // Keep for signing in tests
    ...overrides,
  };
}

export function resetAgentCounter() {
  agentCounter = 0;
}
