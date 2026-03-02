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
} from '@/core/moltprotocol/src/certificates';
import { generateKeyPair } from '@/core/moltprotocol/src/ed25519';
import { generateMoltNumber, verifyMoltNumber } from '@/core/moltnumber/src';

// ── Helpers ──────────────────────────────────────────────

function makeKeys() {
  return generateKeyPair();
}

const NOW = Math.floor(Date.now() / 1000);
const ONE_YEAR = 365 * 24 * 60 * 60;

// ══════════════════════════════════════════════════════════
// ── Carrier Certificate Tests ────────────────────────────
// ══════════════════════════════════════════════════════════

describe('Carrier Certificate (Root → Carrier)', () => {
  const rootKeys = makeKeys();
  const carrierKeys = makeKeys();

  function issueCarrierCert(overrides?: Partial<Parameters<typeof signCarrierCertificate>[0]>): CarrierCertificate {
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

  it('signs and verifies a carrier certificate', () => {
    const cert = issueCarrierCert();
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey);
    expect(result.valid).toBe(true);
  });

  it('includes all required fields', () => {
    const cert = issueCarrierCert();
    expect(cert.version).toBe('1');
    expect(cert.carrierDomain).toBe('moltphone.ai');
    expect(cert.carrierPublicKey).toBe(carrierKeys.publicKey);
    expect(cert.issuedAt).toBe(NOW);
    expect(cert.expiresAt).toBe(NOW + ONE_YEAR);
    expect(cert.issuer).toBe('moltprotocol.org');
    expect(cert.signature).toBeTruthy();
  });

  it('rejects certificate signed by wrong root key', () => {
    const cert = issueCarrierCert();
    const fakeRoot = makeKeys();
    const result = verifyCarrierCertificate(cert, fakeRoot.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/i);
  });

  it('rejects expired certificate', () => {
    const cert = issueCarrierCert({
      issuedAt: NOW - 2 * ONE_YEAR,
      expiresAt: NOW - ONE_YEAR,
    });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/expired/i);
  });

  it('rejects certificate not yet valid', () => {
    const cert = issueCarrierCert({
      issuedAt: NOW + ONE_YEAR,
      expiresAt: NOW + 2 * ONE_YEAR,
    });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/not yet valid/i);
  });

  it('rejects unexpected issuer', () => {
    const cert = issueCarrierCert({ issuer: 'evil.com' });
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, {
      expectedIssuer: 'moltprotocol.org',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unexpected issuer/i);
  });

  it('accepts matching expected issuer', () => {
    const cert = issueCarrierCert();
    const result = verifyCarrierCertificate(cert, rootKeys.publicKey, {
      expectedIssuer: 'moltprotocol.org',
    });
    expect(result.valid).toBe(true);
  });

  it('detects tampering with carrier domain', () => {
    const cert = issueCarrierCert();
    const tampered = { ...cert, carrierDomain: 'evil.com' };
    const result = verifyCarrierCertificate(tampered, rootKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('detects tampering with carrier public key', () => {
    const cert = issueCarrierCert();
    const otherKeys = makeKeys();
    const tampered = { ...cert, carrierPublicKey: otherKeys.publicKey };
    const result = verifyCarrierCertificate(tampered, rootKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('builds deterministic canonical string', () => {
    const a = buildCarrierCertCanonical({
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'KEY',
      issuedAt: 1000,
      expiresAt: 2000,
      issuer: 'moltprotocol.org',
    });
    const b = buildCarrierCertCanonical({
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: 'KEY',
      issuedAt: 1000,
      expiresAt: 2000,
      issuer: 'moltprotocol.org',
    });
    expect(a).toBe(b);
    expect(a).toContain('CARRIER_CERT');
  });
});

// ══════════════════════════════════════════════════════════
// ── Registration Certificate Tests ───────────────────────
// ══════════════════════════════════════════════════════════

describe('Registration Certificate (Carrier → Agent)', () => {
  const carrierKeys = makeKeys();
  const agentKeys = makeKeys();
  const nationCode = 'MOLT';
  const phoneNumber = generateMoltNumber(nationCode, agentKeys.publicKey);

  function issueRegCert(overrides?: Partial<Parameters<typeof signRegistrationCertificate>[0]>): RegistrationCertificate {
    return signRegistrationCertificate({
      phoneNumber,
      agentPublicKey: agentKeys.publicKey,
      nationCode,
      carrierDomain: 'moltphone.ai',
      issuedAt: NOW,
      carrierPrivateKey: carrierKeys.privateKey,
      ...overrides,
    });
  }

  it('signs and verifies a registration certificate', () => {
    const cert = issueRegCert();
    const result = verifyRegistrationCertificate(cert, carrierKeys.publicKey);
    expect(result.valid).toBe(true);
  });

  it('includes all required fields', () => {
    const cert = issueRegCert();
    expect(cert.version).toBe('1');
    expect(cert.phoneNumber).toBe(phoneNumber);
    expect(cert.agentPublicKey).toBe(agentKeys.publicKey);
    expect(cert.nationCode).toBe('MOLT');
    expect(cert.carrierDomain).toBe('moltphone.ai');
    expect(cert.issuedAt).toBe(NOW);
    expect(cert.signature).toBeTruthy();
  });

  it('rejects certificate signed by wrong carrier key', () => {
    const cert = issueRegCert();
    const fakeCarrier = makeKeys();
    const result = verifyRegistrationCertificate(cert, fakeCarrier.publicKey);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/signature mismatch/i);
  });

  it('rejects unexpected carrier domain', () => {
    const cert = issueRegCert({ carrierDomain: 'evil.com' });
    const result = verifyRegistrationCertificate(cert, carrierKeys.publicKey, {
      expectedCarrierDomain: 'moltphone.ai',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/unexpected carrier/i);
  });

  it('detects tampering with phone number', () => {
    const cert = issueRegCert();
    const tampered = { ...cert, phoneNumber: 'MOLT-0000-0000-0000-0000' };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('detects tampering with agent public key', () => {
    const cert = issueRegCert();
    const otherKeys = makeKeys();
    const tampered = { ...cert, agentPublicKey: otherKeys.publicKey };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('detects tampering with nation code', () => {
    const cert = issueRegCert();
    const tampered = { ...cert, nationCode: 'EVIL' };
    const result = verifyRegistrationCertificate(tampered, carrierKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('builds deterministic canonical string', () => {
    const a = buildRegistrationCertCanonical({
      phoneNumber: 'MOLT-AAAA-BBBB-CCCC-DDDD',
      agentPublicKey: 'KEY',
      nationCode: 'MOLT',
      carrierDomain: 'moltphone.ai',
      issuedAt: 1000,
    });
    const b = buildRegistrationCertCanonical({
      phoneNumber: 'MOLT-AAAA-BBBB-CCCC-DDDD',
      agentPublicKey: 'KEY',
      nationCode: 'MOLT',
      carrierDomain: 'moltphone.ai',
      issuedAt: 1000,
    });
    expect(a).toBe(b);
    expect(a).toContain('REGISTRATION_CERT');
  });
});

// ══════════════════════════════════════════════════════════
// ── Full Chain Verification Tests ────────────────────────
// ══════════════════════════════════════════════════════════

describe('Full Chain Verification (Root → Carrier → Agent)', () => {
  const rootKeys = makeKeys();
  const carrierKeys = makeKeys();
  const agentKeys = makeKeys();
  const nationCode = 'SOLR';
  const phoneNumber = generateMoltNumber(nationCode, agentKeys.publicKey);

  const carrierCert = signCarrierCertificate({
    carrierDomain: 'moltphone.ai',
    carrierPublicKey: carrierKeys.publicKey,
    issuedAt: NOW,
    expiresAt: NOW + ONE_YEAR,
    issuer: 'moltprotocol.org',
    rootPrivateKey: rootKeys.privateKey,
  });

  const regCert = signRegistrationCertificate({
    phoneNumber,
    agentPublicKey: agentKeys.publicKey,
    nationCode,
    carrierDomain: 'moltphone.ai',
    issuedAt: NOW,
    carrierPrivateKey: carrierKeys.privateKey,
  });

  it('verifies the full chain: root → carrier → agent', () => {
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
    });
    expect(result.valid).toBe(true);
  });

  it('fails if root key is wrong', () => {
    const fakeRoot = makeKeys();
    const result = verifyFullChain({
      rootPublicKey: fakeRoot.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('carrier_cert');
  });

  it('fails if carrier cert is expired', () => {
    const expiredCarrierCert = signCarrierCertificate({
      carrierDomain: 'moltphone.ai',
      carrierPublicKey: carrierKeys.publicKey,
      issuedAt: NOW - 2 * ONE_YEAR,
      expiresAt: NOW - ONE_YEAR,
      issuer: 'moltprotocol.org',
      rootPrivateKey: rootKeys.privateKey,
    });
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert: expiredCarrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('carrier_cert');
  });

  it('fails if registration cert was signed by wrong carrier', () => {
    const fakeCarrier = makeKeys();
    const badRegCert = signRegistrationCertificate({
      phoneNumber,
      agentPublicKey: agentKeys.publicKey,
      nationCode,
      carrierDomain: 'moltphone.ai',
      issuedAt: NOW,
      carrierPrivateKey: fakeCarrier.privateKey,
    });
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: badRegCert,
      verifyMoltNumber,
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('registration_cert');
  });

  it('fails if MoltNumber does not match agent key (self-certifying check)', () => {
    const otherKeys = makeKeys();
    const wrongNumberRegCert = signRegistrationCertificate({
      phoneNumber: generateMoltNumber(nationCode, otherKeys.publicKey),
      agentPublicKey: agentKeys.publicKey, // key doesn't match the number
      nationCode,
      carrierDomain: 'moltphone.ai',
      issuedAt: NOW,
      carrierPrivateKey: carrierKeys.privateKey,
    });
    const result = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: wrongNumberRegCert,
      verifyMoltNumber,
    });
    expect(result.valid).toBe(false);
    expect(result.failedAt).toBe('self_certifying');
  });

  it('proves the three layers are independent', () => {
    // Self-certifying alone — no network needed
    expect(verifyMoltNumber(phoneNumber, agentKeys.publicKey)).toBe(true);

    // Registration cert — needs carrier public key
    const regResult = verifyRegistrationCertificate(regCert, carrierKeys.publicKey);
    expect(regResult.valid).toBe(true);

    // Carrier cert — needs root public key
    const carrierResult = verifyCarrierCertificate(carrierCert, rootKeys.publicKey);
    expect(carrierResult.valid).toBe(true);

    // Full chain ties them together
    const fullResult = verifyFullChain({
      rootPublicKey: rootKeys.publicKey,
      carrierCert,
      registrationCert: regCert,
      verifyMoltNumber,
    });
    expect(fullResult.valid).toBe(true);
  });
});
