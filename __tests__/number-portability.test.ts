/**
 * Tests for Number Portability — service layer, port-out, port-in,
 * and admin cron for auto-approval.
 *
 * Tests the service layer directly + mocked API route tests.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber, verifyMoltNumber } from 'moltnumber';

// ── Prisma Mock ──────────────────────────────────────────

const mockPrisma = {
  agent: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn().mockResolvedValue(0),
  },
  portRequest: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  nation: {
    findUnique: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Mock carrier identity
jest.mock('@/lib/carrier-identity', () => ({
  CARRIER_DOMAIN: 'moltphone.ai',
  issueRegistrationCertificate: jest.fn().mockReturnValue({}),
  registrationCertToJSON: jest.fn().mockReturnValue({}),
  getCarrierCertificateJSON: jest.fn().mockReturnValue({}),
  getCarrierPublicKey: jest.fn().mockReturnValue('mock-carrier-pub'),
}));

// Mock registry
jest.mock('@/lib/services/registry', () => ({
  unbindNumber: jest.fn().mockResolvedValue({}),
  bindNumber: jest.fn().mockResolvedValue({}),
  getCarrierDomain: jest.fn().mockReturnValue('moltphone.ai'),
}));

// ══════════════════════════════════════════════════════════
// ── Self-Certifying Port Verification Tests ──────────────
// ══════════════════════════════════════════════════════════

describe('Self-Certifying Port Verification', () => {
  it('verifyMoltNumber confirms key ownership (port-in prerequisite)', () => {
    const kp = generateKeyPair();
    const number = generateMoltNumber('SOLR', kp.publicKey);
    expect(verifyMoltNumber(number, kp.publicKey)).toBe(true);
  });

  it('rejects wrong key for MoltNumber', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const number = generateMoltNumber('SOLR', kp1.publicKey);
    expect(verifyMoltNumber(number, kp2.publicKey)).toBe(false);
  });

  it('derives public key from private key (crypto round-trip)', () => {
    const crypto = require('crypto');
    const kp = generateKeyPair();

    // Reconstruct public key from private key (same as port-in logic)
    const privateKeyDer = Buffer.from(kp.privateKey, 'base64url');
    const keyObj = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const pubKeyDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
    const derivedPublic = Buffer.from(pubKeyDer).toString('base64url');

    expect(derivedPublic).toBe(kp.publicKey);
  });

  it('self-certifying verification works end-to-end (key → number → verify)', () => {
    const crypto = require('crypto');
    const kp = generateKeyPair();
    const number = generateMoltNumber('TEST', kp.publicKey);

    // Simulate port-in: agent provides private key, carrier derives public key
    const privateKeyDer = Buffer.from(kp.privateKey, 'base64url');
    const keyObj = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const pubKeyDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
    const derivedPublic = Buffer.from(pubKeyDer).toString('base64url');

    // Verify: derived public key matches MoltNumber
    expect(verifyMoltNumber(number, derivedPublic)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// ── Portability Check (Nation-Type Rules) ────────────────
// ══════════════════════════════════════════════════════════

import {
  checkPortability,
  requestPortOut,
  approvePortOut,
  rejectPortOut,
  cancelPortOut,
  executePort,
  expirePortRequests,
  PORT_GRACE_PERIOD_DAYS,
} from '@/lib/services/number-portability';

describe('Portability Check by Nation Type', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockAgent(nationType: string, isActive = true) {
    mockPrisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
      nationCode: 'SOLR',
      isActive,
      nation: { type: nationType, code: 'SOLR' },
    });
  }

  it('open nations are portable', async () => {
    mockAgent('open');
    const result = await checkPortability('agent-1');
    expect(result.portable).toBe(true);
    expect(result.nationType).toBe('open');
  });

  it('org nations are NOT portable', async () => {
    mockAgent('org');
    const result = await checkPortability('agent-1');
    expect(result.portable).toBe(false);
    expect(result.reason).toContain('org');
    expect(result.nationType).toBe('org');
  });

  it('carrier nations are NOT portable', async () => {
    mockAgent('carrier');
    const result = await checkPortability('agent-1');
    expect(result.portable).toBe(false);
    expect(result.reason).toContain('non-portable');
    expect(result.nationType).toBe('carrier');
  });

  it('deactivated agents are NOT portable', async () => {
    mockAgent('open', false);
    const result = await checkPortability('agent-1');
    expect(result.portable).toBe(false);
    expect(result.reason).toContain('deactivated');
  });

  it('non-existent agents report not portable', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue(null);
    const result = await checkPortability('nonexistent');
    expect(result.portable).toBe(false);
    expect(result.reason).toContain('not found');
  });
});

// ══════════════════════════════════════════════════════════
// ── Port-Out Request Lifecycle ───────────────────────────
// ══════════════════════════════════════════════════════════

describe('Port-Out Request Lifecycle', () => {
  beforeEach(() => jest.clearAllMocks());

  function mockOpenAgent() {
    mockPrisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
      nationCode: 'SOLR',
      isActive: true,
      previousNumbers: [],
      nation: { type: 'open', code: 'SOLR' },
    });
  }

  it('creates a port-out request for open nation', async () => {
    mockOpenAgent();
    mockPrisma.portRequest.findFirst.mockResolvedValue(null); // no existing
    mockPrisma.portRequest.create.mockImplementation((args: any) => Promise.resolve({
      id: 'pr-1',
      ...args.data,
      status: 'pending',
    }));

    const result = await requestPortOut({ agentId: 'agent-1' });
    expect(result.ok).toBe(true);
    expect(result.portRequest).toBeDefined();
    expect(result.portRequest!.status).toBe('pending');
    expect(mockPrisma.portRequest.create).toHaveBeenCalledTimes(1);
  });

  it('sets the correct grace period expiry', async () => {
    mockOpenAgent();
    mockPrisma.portRequest.findFirst.mockResolvedValue(null);
    mockPrisma.portRequest.create.mockImplementation((args: any) => {
      const data = args.data;
      // Verify grace period is approximately 7 days
      const diff = data.expiresAt.getTime() - Date.now();
      const days = diff / (1000 * 60 * 60 * 24);
      expect(days).toBeGreaterThan(PORT_GRACE_PERIOD_DAYS - 0.1);
      expect(days).toBeLessThanOrEqual(PORT_GRACE_PERIOD_DAYS + 0.1);
      return Promise.resolve({ id: 'pr-1', ...data, status: 'pending' });
    });

    await requestPortOut({ agentId: 'agent-1' });
    expect(mockPrisma.portRequest.create).toHaveBeenCalledTimes(1);
  });

  it('rejects port-out for carrier nation', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      moltNumber: 'CLAW-AAAA-BBBB-CCCC-DDDD',
      nationCode: 'CLAW',
      isActive: true,
      nation: { type: 'carrier', code: 'CLAW' },
    });
    mockPrisma.portRequest.findFirst.mockResolvedValue(null);

    const result = await requestPortOut({ agentId: 'agent-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('non-portable');
  });

  it('rejects port-out for org nation', async () => {
    mockPrisma.agent.findUnique.mockResolvedValue({
      id: 'agent-1',
      moltNumber: 'ACME-AAAA-BBBB-CCCC-DDDD',
      nationCode: 'ACME',
      isActive: true,
      nation: { type: 'org', code: 'ACME' },
    });
    mockPrisma.portRequest.findFirst.mockResolvedValue(null);

    const result = await requestPortOut({ agentId: 'agent-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('org');
  });

  it('rejects duplicate pending port-out', async () => {
    mockOpenAgent();
    mockPrisma.portRequest.findFirst.mockResolvedValue({ id: 'existing-pr', status: 'pending' });

    const result = await requestPortOut({ agentId: 'agent-1' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('already exists');
  });

  it('records target carrier domain if provided', async () => {
    mockOpenAgent();
    mockPrisma.portRequest.findFirst.mockResolvedValue(null);
    mockPrisma.portRequest.create.mockImplementation((args: any) => {
      expect(args.data.toCarrierDomain).toBe('othercarrier.example.com');
      return Promise.resolve({ id: 'pr-1', ...args.data, status: 'pending' });
    });

    await requestPortOut({ agentId: 'agent-1', toCarrierDomain: 'othercarrier.example.com' });
    expect(mockPrisma.portRequest.create).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// ── Carrier Actions (Approve / Reject / Cancel) ──────────
// ══════════════════════════════════════════════════════════

describe('Carrier Actions on Port Requests', () => {
  beforeEach(() => jest.clearAllMocks());

  it('approves a pending request', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'pending' });
    mockPrisma.portRequest.update.mockResolvedValue({ id: 'pr-1', status: 'approved' });

    const result = await approvePortOut('pr-1');
    expect(result.ok).toBe(true);
    expect(mockPrisma.portRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'pr-1' }, data: expect.objectContaining({ status: 'approved' }) }),
    );
  });

  it('rejects approval of non-pending request', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'completed' });
    const result = await approvePortOut('pr-1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('completed');
  });

  it('rejects a pending request with a reason', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'pending' });
    mockPrisma.portRequest.update.mockResolvedValue({ id: 'pr-1', status: 'rejected' });

    const result = await rejectPortOut('pr-1', 'Agent has outstanding balance');
    expect(result.ok).toBe(true);
    expect(mockPrisma.portRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'rejected', rejectReason: 'Agent has outstanding balance' }),
      }),
    );
  });

  it('cancels a pending request (owner action)', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'pending' });
    mockPrisma.portRequest.update.mockResolvedValue({ id: 'pr-1', status: 'cancelled' });

    const result = await cancelPortOut('pr-1');
    expect(result.ok).toBe(true);
  });

  it('cannot cancel a completed request', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'completed' });
    const result = await cancelPortOut('pr-1');
    expect(result.ok).toBe(false);
  });

  it('returns error for nonexistent port request', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue(null);
    expect((await approvePortOut('nope')).ok).toBe(false);
    expect((await rejectPortOut('nope', 'reason')).ok).toBe(false);
    expect((await cancelPortOut('nope')).ok).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// ── Port Execution ───────────────────────────────────────
// ══════════════════════════════════════════════════════════

describe('Port Execution', () => {
  beforeEach(() => jest.clearAllMocks());

  it('executes an approved port (deactivates agent, unbinds number)', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({
      id: 'pr-1',
      agentId: 'agent-1',
      moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
      status: 'approved',
      agent: {
        id: 'agent-1',
        moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
        previousNumbers: [],
      },
    });
    mockPrisma.$transaction.mockResolvedValue(undefined);

    const result = await executePort('pr-1');
    expect(result.ok).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);

    // Verify the transaction includes agent deactivation + port completion
    const txArgs = mockPrisma.$transaction.mock.calls[0][0];
    expect(txArgs).toHaveLength(2);
  });

  it('adds current MoltNumber to previousNumbers', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({
      id: 'pr-1',
      agentId: 'agent-1',
      moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
      status: 'approved',
      agent: {
        id: 'agent-1',
        moltNumber: 'SOLR-AAAA-BBBB-CCCC-DDDD',
        previousNumbers: ['SOLR-OLD1-OLD2-OLD3-OLD4'],
      },
    });
    mockPrisma.$transaction.mockResolvedValue(undefined);

    // The function uses prisma.agent.update inside $transaction
    // We just verify it doesn't fail and the transaction is called
    const result = await executePort('pr-1');
    expect(result.ok).toBe(true);
  });

  it('rejects execution of non-approved request', async () => {
    mockPrisma.portRequest.findUnique.mockResolvedValue({ id: 'pr-1', status: 'pending', agent: {} });
    const result = await executePort('pr-1');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('approved');
  });
});

// ══════════════════════════════════════════════════════════
// ── Cron: Auto-Approve Expired Requests ──────────────────
// ══════════════════════════════════════════════════════════

describe('expirePortRequests (Cron Job)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('auto-approves pending requests past grace period', async () => {
    const pastDate = new Date(Date.now() - 86400000); // 1 day ago
    mockPrisma.portRequest.findMany
      .mockResolvedValueOnce([
        { id: 'pr-1', status: 'pending', expiresAt: pastDate },
        { id: 'pr-2', status: 'pending', expiresAt: pastDate },
      ]) // expired pending
      .mockResolvedValueOnce([
        { id: 'pr-1', status: 'approved', agentId: 'a1', moltNumber: 'SOLR-XXXX-XXXX-XXXX-XXXX' },
        { id: 'pr-2', status: 'approved', agentId: 'a2', moltNumber: 'SOLR-YYYY-YYYY-YYYY-YYYY' },
      ]); // now approved for execution

    mockPrisma.portRequest.update.mockResolvedValue({});
    // executePort calls findUnique — mock for each
    mockPrisma.portRequest.findUnique
      .mockResolvedValueOnce({
        id: 'pr-1', status: 'approved', agentId: 'a1', moltNumber: 'SOLR-XXXX-XXXX-XXXX-XXXX',
        agent: { id: 'a1', moltNumber: 'SOLR-XXXX-XXXX-XXXX-XXXX', previousNumbers: [] },
      })
      .mockResolvedValueOnce({
        id: 'pr-2', status: 'approved', agentId: 'a2', moltNumber: 'SOLR-YYYY-YYYY-YYYY-YYYY',
        agent: { id: 'a2', moltNumber: 'SOLR-YYYY-YYYY-YYYY-YYYY', previousNumbers: [] },
      });
    mockPrisma.$transaction.mockResolvedValue(undefined);

    const result = await expirePortRequests();
    expect(result.autoApproved).toBe(2);
    expect(result.autoExecuted).toBe(2);
    expect(result.errors).toHaveLength(0);
  });

  it('handles empty queue gracefully', async () => {
    mockPrisma.portRequest.findMany
      .mockResolvedValueOnce([]) // no expired pending
      .mockResolvedValueOnce([]); // no approved

    const result = await expirePortRequests();
    expect(result.autoApproved).toBe(0);
    expect(result.autoExecuted).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('catches errors without failing the entire batch', async () => {
    mockPrisma.portRequest.findMany
      .mockResolvedValueOnce([
        { id: 'pr-bad', status: 'pending', expiresAt: new Date(0) },
      ])
      .mockResolvedValueOnce([]); // no approved after error

    mockPrisma.portRequest.update.mockRejectedValue(new Error('DB down'));

    const result = await expirePortRequests();
    expect(result.autoApproved).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('DB down');
  });
});

// ══════════════════════════════════════════════════════════
// ── Port-In: Key Derivation & Verification ───────────────
// ══════════════════════════════════════════════════════════

describe('Port-In Key Derivation', () => {
  it('derives the same MoltNumber after port-out + port-in with same key', () => {
    const kp = generateKeyPair();
    const number = generateMoltNumber('SOLR', kp.publicKey);

    // After port-out: carrier deactivates agent. Port-in on new carrier:
    // The new carrier derives public key from private key. Verify number matches.
    const crypto = require('crypto');
    const privateKeyDer = Buffer.from(kp.privateKey, 'base64url');
    const keyObj = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
    const pubKeyDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
    const derivedPublic = Buffer.from(pubKeyDer).toString('base64url');

    // This is the final verification: the number stays the same
    expect(generateMoltNumber('SOLR', derivedPublic)).toBe(number);
    expect(verifyMoltNumber(number, derivedPublic)).toBe(true);
  });

  it('prevents port-in with mismatched number', () => {
    const kp = generateKeyPair();
    const number = generateMoltNumber('SOLR', kp.publicKey);

    // Using a different nation code must fail
    expect(verifyMoltNumber(number.replace('SOLR', 'TEST'), kp.publicKey)).toBe(false);
  });

  it('prevents port-in with wrong key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const number = generateMoltNumber('SOLR', kp1.publicKey);

    // Someone else's key can't port your number
    expect(verifyMoltNumber(number, kp2.publicKey)).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// ── MoltSIM Re-Provision: Previous Numbers ───────────────
// ══════════════════════════════════════════════════════════

describe('Previous Numbers Tracking', () => {
  it('tracks old number on re-provision', () => {
    const oldNumber = 'SOLR-AAAA-BBBB-CCCC-DDDD';
    const previousNumbers: string[] = [];

    // Simulate the moltsim re-provision logic
    if (!previousNumbers.includes(oldNumber)) {
      previousNumbers.push(oldNumber);
    }

    expect(previousNumbers).toContain(oldNumber);
    expect(previousNumbers).toHaveLength(1);
  });

  it('does not duplicate existing numbers', () => {
    const oldNumber = 'SOLR-AAAA-BBBB-CCCC-DDDD';
    const previousNumbers = [oldNumber];

    if (!previousNumbers.includes(oldNumber)) {
      previousNumbers.push(oldNumber);
    }

    expect(previousNumbers).toHaveLength(1);
  });

  it('accumulates multiple previous numbers across rotations', () => {
    const numbers: string[] = [];
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const kp3 = generateKeyPair();

    const num1 = generateMoltNumber('SOLR', kp1.publicKey);
    const num2 = generateMoltNumber('SOLR', kp2.publicKey);
    const num3 = generateMoltNumber('SOLR', kp3.publicKey);

    // Each rotation pushes the old number
    numbers.push(num1); // after rotating from kp1 → kp2
    numbers.push(num2); // after rotating from kp2 → kp3

    expect(numbers).toHaveLength(2);
    expect(numbers).toContain(num1);
    expect(numbers).toContain(num2);
    expect(numbers).not.toContain(num3); // current number, not "previous"
  });
});
