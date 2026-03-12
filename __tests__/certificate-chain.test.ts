/**
 * Tests for Certificate Chain — two-level trust hierarchy.
 *
 * Root (moltprotocol.org) → Carrier (moltphone.ai) → Agent (MOLT-XXXX-...)
 *
 * Tests cover:
 *   1. Carrier certificate (root signs carrier authorization)
 *   2. Registration certificate (carrier signs agent registration)
 *   3. Full chain verification (root → carrier → agent → self-certifying)
 *   4. Failure modes (expired, wrong keys, tampered, domain mismatch)
 *   5. JSON serialization helpers
 *   6. Carrier-level convenience functions
 */

import {
  signCarrierCertificate,
  verifyCarrierCertificate,
  signRegistrationCertificate,
  verifyRegistrationCertificate,
  verifyFullChain,
  buildCarrierCertCanonical,
  buildRegistrationCertCanonical,
  type CarrierCertificate,
  type RegistrationCertificate,
} from '@moltprotocol/core';

import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber, verifyMoltNumber } from 'moltnumber';

// ── Test fixtures ────────────────────────────────────────

function makeRootKeys() {
  return generateKeyPair();
}

function makeCarrierKeys() {
  return generateKeyPair();
}

function makeAgentKeys() {
  return generateKeyPair();
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_YEAR = 365 * 24 * 60 * 60;

function makeCarrierCert(
  rootKeys: ReturnType<typeof generateKeyPair>,
  carrierKeys: ReturnType<typeof generateKeyPair>,
  overrides: Partial<Parameters<typeof signCarrierCertificate>[0]> = {},
): CarrierCertificate {
  return signCarrierCertificate({
    carrierDomain: 'moltphone.ai',
    carrierPublicKey: carrierKeys.publicKey,
    issuedAt: NOW,
    expiresAt: NOW + ONE_YEAR,
    issuer: 'moltprotocol.org',
    rootPrivateKey: rootKeys.privateKey,
    ...overrides,
  });
}

function makeRegCert(
  carrierKeys: ReturnType<typeof generateKeyPair>,
  moltNumber: string,
  agentPublicKey: string,
  overrides: Partial<Parameters<typeof signRegistrationCertificate>[0]> = {},
): RegistrationCertificate {
  return signRegistrationCertificate({
    moltNumber,
    agentPublicKey,
    nationCode: 'TEST',
    carrierDomain: 'moltphone.ai',
    issuedAt: NOW,
    carrierPrivateKey: carrierKeys.privateKey,
    ...overrides,
  });
}

// ══════════════════════════════════════════════════════════
// ── Carrier Certificate (Root → Carrier) ─────────────────
// ══════════════════════════════════════════════════════════

describe('Carrier Certificate — Canonical String', () => {
  it('builds canonical string with all fields joined by newlines', () => {
    const result = buildCarrierCertCanonical({
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'test-key',
      issuedAt: 1700000000,
      expiresAt: 1731536000,
      issuer: 'moltprotocol.org',
    });
    expect(result).toBe(
      'CARRIER_CERT\n1\nmoltphone.ai\ntest-key\n1700000000\n1731536000\nmoltprotocol.org',
    );
  });

  it('includes CARRIER_CERT prefix and version', () => {
    const result = buildCarrierCertCanonical({
      carrierDomain: 'x',
      carrierPublicKey: 'y',
      issuedAt: 0,
      expiresAt: 1,
      issuer: 'z',
    });
    expect(result.startsWith('CARRIER_CERT\n1\n')).toBe(true);
  });
});

describe('Carrier Certificate — Sign & Verify', () => {
  const rootKeys = makeRootKeys();
  const carrierKeys = makeCarrierKeys();

  it('round-trip: sign then verify succeeds', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys);
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(true);
  });

  it('rejects signature with wrong root public key', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys);
    const otherRoot = makeRootKeys();
    const result = verifyCarrierCertificate(cert, otherRoot.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it('rejects expired certificate', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys, {
      issuedAt: NOW - ONE_YEAR * 2,
      expiresAt: NOW - ONE_YEAR,
    });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects future certificate (issuedAt in the future)', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys, {
      issuedAt: NOW + 3600,
      expiresAt: NOW + ONE_YEAR,
    });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not yet valid/i);
  });

  it('rejects mismatched issuer when expectedIssuer is set', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys, { issuer: 'evil.org' });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, {
      now: NOW,
      expectedIssuer: 'moltprotocol.org',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/issuer/i);
  });

  it('detects tampered carrier domain', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys);
    const tampered = { ...cert, carrierDomain: 'evil.com' };
    const result = verifyCarrierCertificate(tampered, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it('detects tampered carrier public key', () => {
    const cert = makeCarrierCert(rootKeys, carrierKeys);
    const otherKey = makeCarrierKeys();
    const tampered = { ...cert, carrierPublicKey: otherKey.publicKey };
    const result = verifyCarrierCertificate(tampered, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// ── Registration Certificate (Carrier → Agent) ──────────
// ══════════════════════════════════════════════════════════

describe('Registration Certificate — Canonical String', () => {
  it('builds canonical string with all fields joined by newlines', () => {
    const result = buildRegistrationCertCanonical({
      moltNumber: 'TEST-1234-5678-ABCD-EFGH',
      agentPublicKey: 'agent-key',
      nationCode: 'TEST',
      carrierDomain: 'moltphone.ai',
      issuedAt: 1700000000,
    });
    expect(result).toBe(
      'REGISTRATION_CERT\n1\nTEST-1234-5678-ABCD-EFGH\nagent-key\nTEST\nmoltphone.ai\n1700000000',
    );
  });

  it('includes REGISTRATION_CERT prefix and version', () => {
    const result = buildRegistrationCertCanonical({
      moltNumber: 'X',
      agentPublicKey: 'Y',
      nationCode: 'Z',
      carrierDomain: 'W',
      issuedAt: 0,
    });
    expect(result.startsWith('REGISTRATION_CERT\n1\n')).toBe(true);
  });
});

describe('Registration Certificate — Sign & Verify', () => {
  const carrierKeys = makeCarrierKeys();
  const agentKeys = makeAgentKeys();
  const moltNumber = generateMoltNumber('TEST', agentKeys.publicKey);

  it('round-trip: sign then verify succeeds', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);
    const result = verifyRegistrationCertificate(cert, carrierKeys.publicKey);
    expect(result.valid).toBe(true);
  });

  it('rejects signature with wrong carrier public key', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);
    const otherCarrier = makeCarrierKeys();
    const result = verifyRegistrationCertificate(cert, otherCarrier.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature/i);
  });

  it('rejects mismatched carrier domain when expectedCarrierDomain is set', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey, {
      carrierDomain: 'other-carrier.com',
    });
    const result = verifyRegistrationCertificate(cert, carrierKeys.publicKey, {
      expectedCarrierDomain: 'moltphone.ai',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/carrier/i);
  });

  it('detects tampered MoltNumber', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);
    const tampered = { ...cert, moltNumber: 'TEST-XXXX-XXXX-XXXX-XXXX' };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('detects tampered agent public key', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);
    const otherAgent = makeAgentKeys();
    const tampered = { ...cert, agentPublicKey: otherAgent.publicKey };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('detects tampered nation code', () => {
    const cert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);
    const tampered = { ...cert, nationCode: 'EVIL' };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════
// ── Full Chain Verification ──────────────────────────────
// ══════════════════════════════════════════════════════════

describe('Full Chain Verification', () => {
  const rootKeys = makeRootKeys();
  const carrierKeys = makeCarrierKeys();
  const agentKeys = makeAgentKeys();
  const moltNumber = generateMoltNumber('TEST', agentKeys.publicKey);

  const carrierCert = makeCarrierCert(rootKeys, carrierKeys);
  const regCert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey);

  it('passes with valid chain: root → carrier → agent → self-certifying', () => {
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(true);
    expect(result.failedAt).toBeUndefined();
  });

  it('fails at carrier_cert with wrong root key', () => {
    const otherRoot = makeRootKeys();
    const result = verifyFullChain({
      rootPublicKey: otherRoot.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('carrier_cert');
  });

  it('fails at registration_cert with cert signed by different carrier', () => {
    const otherCarrier = makeCarrierKeys();
    const otherRegCert = makeRegCert(otherCarrier, moltNumber, agentKeys.publicKey);
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: otherRegCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('registration_cert');
  });

  it('fails at self_certifying when MoltNumber does not match key', () => {
    // Use a different agent key for the reg cert, so number ↔ key doesn't match
    const wrongAgent = makeAgentKeys();
    const wrongRegCert = makeRegCert(carrierKeys, moltNumber, wrongAgent.publicKey);
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: wrongRegCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('self_certifying');
  });

  it('fails if carrier cert is expired', () => {
    const expiredCarrierCert = makeCarrierCert(rootKeys, carrierKeys, {
      issuedAt: NOW - ONE_YEAR * 2,
      expiresAt: NOW - ONE_YEAR,
    });
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert: expiredCarrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('carrier_cert');
    expect(result.reason).toMatch(/expired/i);
  });

  it('uses carrier public key from cert for reg cert verification', () => {
    // This tests that verifyFullChain trusts the carrier key FROM the cert,
    // not a separately-provided one. If someone swaps the carrier cert for
    // one with a different key, the reg cert won't verify.
    const evilCarrier = makeCarrierKeys();
    const evilCarrierCert = makeCarrierCert(rootKeys, evilCarrier);
    // regCert was signed by the original carrierKeys, not evilCarrier
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert: evilCarrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('registration_cert');
  });
});

// ══════════════════════════════════════════════════════════
// ── Self-Certifying Integration ──────────────────────────
// ══════════════════════════════════════════════════════════

describe('Self-Certifying MoltNumber ↔ Certificate Chain', () => {
  it('MoltNumber derived from agent public key passes verifyMoltNumber', () => {
    const agentKeys = makeAgentKeys();
    const num = generateMoltNumber('TEST', agentKeys.publicKey);
    expect(verifyMoltNumber(num, agentKeys.publicKey)).toBe(true);
  });

  it('MoltNumber fails with different public key', () => {
    const agentKeys = makeAgentKeys();
    const otherKeys = makeAgentKeys();
    const num = generateMoltNumber('TEST', agentKeys.publicKey);
    expect(verifyMoltNumber(num, otherKeys.publicKey)).toBe(false);
  });

  it('same key in different nation produces different MoltNumber', () => {
    const agentKeys = makeAgentKeys();
    const num1 = generateMoltNumber('AABB', agentKeys.publicKey);
    const num2 = generateMoltNumber('CCDD', agentKeys.publicKey);
    expect(num1).not.toBe(num2);
    // But both verify
    expect(verifyMoltNumber(num1, agentKeys.publicKey)).toBe(true);
    expect(verifyMoltNumber(num2, agentKeys.publicKey)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════
// ── Security Properties ──────────────────────────────────
// ══════════════════════════════════════════════════════════

describe('Certificate Chain — Security Properties', () => {
  it('carrier cannot forge a cert for a different root', () => {
    const rootKeys = makeRootKeys();
    const carrierKeys = makeCarrierKeys();
    // Carrier tries to sign its own cert pretending to be root
    const forgery = signCarrierCertificate({
      carrierDomain: 'evil-carrier.com',
      carrierPublicKey: carrierKeys.publicKey,
      issuedAt: NOW,
      expiresAt: NOW + ONE_YEAR,
      issuer: 'moltprotocol.org',
      rootPrivateKey: carrierKeys.privateKey, // wrong key!
    });
    const result = verifyCarrierCertificate(forgery, rootKeys.publicKey, { now: NOW });
    expect(result.valid).toBe(false);
  });

  it('agent cannot forge a registration cert', () => {
    const carrierKeys = makeCarrierKeys();
    const agentKeys = makeAgentKeys();
    const moltNumber = generateMoltNumber('TEST', agentKeys.publicKey);
    // Agent tries to sign its own reg cert pretending to be carrier
    const forgery = signRegistrationCertificate({
      moltNumber,
      agentPublicKey: agentKeys.publicKey,
      nationCode: 'TEST',
      carrierDomain: 'moltphone.ai',
      issuedAt: NOW,
      carrierPrivateKey: agentKeys.privateKey, // wrong key!
    });
    const result = verifyRegistrationCertificate(forgery, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('swapping reg cert between agents is detected by self-certifying check', () => {
    const rootKeys = makeRootKeys();
    const carrierKeys = makeCarrierKeys();
    const agent1 = makeAgentKeys();
    const agent2 = makeAgentKeys();
    const num1 = generateMoltNumber('TEST', agent1.publicKey);
    // Carrier legitimately signs for agent1
    const carrierCert = makeCarrierCert(rootKeys, carrierKeys);
    const regCert1 = makeRegCert(carrierKeys, num1, agent1.publicKey);
    // Attacker tries to use agent1's cert but present agent2's key
    // The reg cert is valid (carrier signed it), but the number won't match agent2
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: regCert1,
      // Custom verify that checks against agent2's key
      verifyMoltNumber: (number, pubKey) => {
        // Simulate: "I am agent2 but presenting agent1's cert"
        return verifyMoltNumber(number, agent2.publicKey);
      },
      opts: { now: NOW },
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('self_certifying');
  });

  it('certificates are bound to specific carrier domains', () => {
    const rootKeys = makeRootKeys();
    const carrierKeys = makeCarrierKeys();
    const agentKeys = makeAgentKeys();
    const moltNumber = generateMoltNumber('TEST', agentKeys.publicKey);
    // Carrier cert for "moltphone.ai"
    const carrierCert = makeCarrierCert(rootKeys, carrierKeys);
    // Reg cert claims a different carrier domain
    const regCert = makeRegCert(carrierKeys, moltNumber, agentKeys.publicKey, {
      carrierDomain: 'other-carrier.com',
    });
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
      opts: { now: NOW },
    });
    // Fails because reg cert domain doesn't match carrier cert domain
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('registration_cert');
  });
});
