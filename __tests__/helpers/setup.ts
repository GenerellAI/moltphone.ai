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

  return new NextRequest(url, init as any);
}

// ── Response helpers ─────────────────────────────────────

export async function parseJson(response: Response): Promise<unknown> {
  return response.json();
}

// ── Mock nation ──────────────────────────────────────────

export const TEST_NATION = {
  id: 'test-nation-id',
  code: 'MPHO',
  type: 'carrier',
  displayName: 'MoltPhone',
  description: 'The default carrier nation',
  badge: '⚡',
  isPublic: true,
  isActive: true,
  provisionalUntil: null,
  verifiedDomain: null,
  domainVerifiedAt: null,
  publicKey: null,
  memberUserIds: [],
  adminUserIds: [],
  ownerId: TEST_USER.id,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ── Mock agent builder ───────────────────────────────────

import { generateKeyPair, signRequest } from '../../lib/ed25519';
import { generateMoltNumber } from '../../lib/molt-number';

let agentCounter = 0;

export function buildMockAgent(overrides: Record<string, unknown> = {}) {
  agentCounter++;
  const kp = generateKeyPair();
  const moltNumber = generateMoltNumber('MPHO', kp.publicKey);

  return {
    id: `agent-${agentCounter}`,
    moltNumber,
    nationCode: 'MPHO',
    ownerId: TEST_USER.id,
    displayName: `Test Agent ${agentCounter}`,
    description: 'A test agent',
    avatarUrl: null,
    skills: ['call', 'text'],
    endpointUrl: null,
    callEnabled: true,
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
    nation: { code: 'MPHO', type: 'carrier', displayName: 'MoltPhone', badge: '🪼' },
    owner: { id: TEST_USER.id, name: 'Test User' },
    _keyPair: kp, // Keep for signing in tests
    ...overrides,
  };
}

export function resetAgentCounter() {
  agentCounter = 0;
}

// ── Signed request helpers ───────────────────────────────

/**
 * Build a signed NextRequest for Ed25519-authenticated call routes.
 * Uses the agent's _keyPair to produce valid X-Molt-* headers.
 */
export function buildSignedRequest(
  method: string,
  path: string,
  agent: ReturnType<typeof buildMockAgent>,
  options: {
    body?: unknown;
    targetMoltNumber?: string;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  } = {},
): NextRequest {
  const bodyStr = options.body !== undefined ? JSON.stringify(options.body) : '';
  const target = options.targetMoltNumber ?? agent.moltNumber;

  const signed = signRequest({
    method,
    path,
    callerAgentId: agent.moltNumber,
    targetAgentId: target,
    body: bodyStr,
    privateKey: agent._keyPair.privateKey,
  });

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
      ...signed,
      ...options.headers,
    },
  };

  if (options.body !== undefined) {
    init.body = bodyStr;
  }

  return new NextRequest(url, init as any);
}
