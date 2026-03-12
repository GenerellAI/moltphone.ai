/**
 * Tests for Nation Delegation — delegation certificates, keypair management,
 * and enforcement. Tests the service layer only (no HTTP routes).
 */

import {
  signDelegationCertificate,
  verifyDelegationCertificate,
  buildDelegationCertCanonical,
  type DelegationCertificate,
} from '@moltprotocol/core';
import { generateKeyPair } from '@moltprotocol/core';

// ── Helpers ──────────────────────────────────────────────

function makeKeys() {
  return generateKeyPair();
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_YEAR = 365 * 24 * 60 * 60;

// ══════════════════════════════════════════════════════════
// ── Delegation Certificate Crypto Tests ──────────────────
// ══════════════════════════════════════════════════════════

describe('Delegation Certificate (Nation → Carrier)', () => {
  const nationKeys = makeKeys();
  const carrierKeys = makeKeys();

  function issueDelegation(overrides?: Partial<Parameters<typeof signDelegationCertificate>[0]>): DelegationCertificate {
    return signDelegationCertificate({
      nationCode: 'SOLR',
      nationPublicKey: nationKeys.publicKey,
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: carrierKeys.publicKey,
      issuedAt: NOW,
      nationPrivateKey: nationKeys.privateKey,
      ...overrides,
    });
  }

  // ── Signing ────────────────────────────────────────────

  it('signs a valid delegation certificate', () => {
    const cert = issueDelegation();

    expect(cert.version).toBe('1');
    expect(cert.nationCode).toBe('SOLR');
    expect(cert.nationPublicKey).toBe(nationKeys.publicKey);
    expect(cert.carrierDomain).toBe('moltphone.ai');
    expect(cert.carrierPublicKey).toBe(carrierKeys.publicKey);
    expect(cert.issuedAt).toBe(NOW);
    expect(cert.signature).toBeTruthy();
    expect(cert.expiresAt).toBeUndefined();
  });

  it('signs with expiry', () => {
    const cert = issueDelegation({ expiresAt: NOW + ONE_YEAR });

    expect(cert.expiresAt).toBe(NOW + ONE_YEAR);
  });

  // ── Verification ───────────────────────────────────────

  it('verifies a valid delegation certificate', () => {
    const cert = issueDelegation();
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey);

    expect(result.valid).toBe(true);
  });

  it('verifies with expiry (still valid)', () => {
    const cert = issueDelegation({ expiresAt: NOW + ONE_YEAR });
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, { now: NOW + 100 });

    expect(result.valid).toBe(true);
  });

  it('rejects expired delegation', () => {
    const cert = issueDelegation({ expiresAt: NOW + 10 });
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, { now: NOW + 20 });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('expired');
  });

  it('rejects delegation not yet valid', () => {
    const cert = issueDelegation({ issuedAt: NOW + 1000 });
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, { now: NOW });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('not yet valid');
  });

  it('rejects wrong nation public key', () => {
    const cert = issueDelegation();
    const wrongKeys = makeKeys();
    const result = verifyDelegationCertificate(cert, wrongKeys.publicKey);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('rejects tampered signature', () => {
    const cert = issueDelegation();
    const tampered = { ...cert, carrierDomain: 'evil.com' };
    const result = verifyDelegationCertificate(tampered, nationKeys.publicKey);

    expect(result.valid).toBe(false);
  });

  it('rejects signature from a different keypair', () => {
    const otherNation = makeKeys();
    const cert = signDelegationCertificate({
      nationCode: 'SOLR',
      nationPublicKey: nationKeys.publicKey, // Claims to be nationKeys
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: carrierKeys.publicKey,
      issuedAt: NOW,
      nationPrivateKey: otherNation.privateKey, // But signed with different key
    });

    const result = verifyDelegationCertificate(cert, nationKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  // ── Expected constraints ───────────────────────────────

  it('enforces expected nation code', () => {
    const cert = issueDelegation({ nationCode: 'WOLF' });
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, {
      expectedNationCode: 'SOLR',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unexpected nation code');
  });

  it('enforces expected carrier domain', () => {
    const cert = issueDelegation();
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, {
      expectedCarrierDomain: 'other.ai',
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Unexpected carrier domain');
  });

  // ── Canonical string ───────────────────────────────────

  it('builds deterministic canonical string', () => {
    const a = buildDelegationCertCanonical({
      nationCode: 'SOLR',
      nationPublicKey: 'pk1',
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'pk2',
      issuedAt: 1000,
      expiresAt: 2000,
    });
    const b = buildDelegationCertCanonical({
      nationCode: 'SOLR',
      nationPublicKey: 'pk1',
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'pk2',
      issuedAt: 1000,
      expiresAt: 2000,
    });

    expect(a).toBe(b);
    expect(a).toContain('DELEGATION_CERT');
    expect(a).toContain('SOLR');
  });

  it('encodes no-expiry as empty string', () => {
    const canonical = buildDelegationCertCanonical({
      nationCode: 'SOLR',
      nationPublicKey: 'pk1',
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'pk2',
      issuedAt: 1000,
    });

    const lines = canonical.split('\n');
    expect(lines[lines.length - 1]).toBe(''); // expiresAt line is empty
  });
});

// ══════════════════════════════════════════════════════════
// ── Delegation Service JSON Serialization ────────────────
// ══════════════════════════════════════════════════════════

describe('delegationCertToJSON', () => {
  // Import separately so we test the actual export
  it('converts cert to wire format', async () => {
    const { delegationCertToJSON } = await import('@/lib/services/nation-delegation');

    const cert: DelegationCertificate = {
      version: '1',
      nationCode: 'SOLR',
      nationPublicKey: 'npk',
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'cpk',
      issuedAt: 1000,
      expiresAt: 2000,
      signature: 'sig',
    };

    const json = delegationCertToJSON(cert);

    expect(json.version).toBe('1');
    expect(json.nation_code).toBe('SOLR');
    expect(json.nation_public_key).toBe('npk');
    expect(json.carrier_domain).toBe('moltphone.ai');
    expect(json.carrier_public_key).toBe('cpk');
    expect(json.issued_at).toBe(1000);
    expect(json.expires_at).toBe(2000);
    expect(json.signature).toBe('sig');
  });

  it('omits expires_at when undefined', async () => {
    const { delegationCertToJSON } = await import('@/lib/services/nation-delegation');

    const cert: DelegationCertificate = {
      version: '1',
      nationCode: 'SOLR',
      nationPublicKey: 'npk',
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'cpk',
      issuedAt: 1000,
      signature: 'sig',
    };

    const json = delegationCertToJSON(cert);
    expect(json.expires_at).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════
// ── Multi-Carrier Delegation Trust Chain ─────────────────
// ══════════════════════════════════════════════════════════

describe('Delegation trust chain', () => {
  it('nation can delegate to multiple carriers', () => {
    const nationKeys = makeKeys();
    const carrier1 = makeKeys();
    const carrier2 = makeKeys();

    const cert1 = signDelegationCertificate({
      nationCode: 'ACME',
      nationPublicKey: nationKeys.publicKey,
      carrierDomain: 'carrier1.com',
      carrierPublicKey: carrier1.publicKey,
      issuedAt: NOW,
      nationPrivateKey: nationKeys.privateKey,
    });

    const cert2 = signDelegationCertificate({
      nationCode: 'ACME',
      nationPublicKey: nationKeys.publicKey,
      carrierDomain: 'carrier2.com',
      carrierPublicKey: carrier2.publicKey,
      issuedAt: NOW,
      nationPrivateKey: nationKeys.privateKey,
    });

    expect(verifyDelegationCertificate(cert1, nationKeys.publicKey).valid).toBe(true);
    expect(verifyDelegationCertificate(cert2, nationKeys.publicKey).valid).toBe(true);
  });

  it('delegation is carrier-specific (cannot reuse for different carrier)', () => {
    const nationKeys = makeKeys();
    const carrier1 = makeKeys();

    const cert = signDelegationCertificate({
      nationCode: 'ACME',
      nationPublicKey: nationKeys.publicKey,
      carrierDomain: 'carrier1.com',
      carrierPublicKey: carrier1.publicKey,
      issuedAt: NOW,
      nationPrivateKey: nationKeys.privateKey,
    });

    // Try to claim it's for carrier2.com
    const result = verifyDelegationCertificate(cert, nationKeys.publicKey, {
      expectedCarrierDomain: 'carrier2.com',
    });

    expect(result.valid).toBe(false);
  });

  it('key rotation invalidates old delegations', () => {
    const oldKeys = makeKeys();
    const newKeys = makeKeys();
    const carrier = makeKeys();

    // Signed with old keys
    const cert = signDelegationCertificate({
      nationCode: 'ACME',
      nationPublicKey: oldKeys.publicKey,
      carrierDomain: 'carrier.com',
      carrierPublicKey: carrier.publicKey,
      issuedAt: NOW,
      nationPrivateKey: oldKeys.privateKey,
    });

    // Valid against old key
    expect(verifyDelegationCertificate(cert, oldKeys.publicKey).valid).toBe(true);

    // Invalid against new key (simulates key rotation — nation.publicKey changed)
    const result = verifyDelegationCertificate(cert, newKeys.publicKey);
    expect(result.valid).toBe(false);
  });
});
