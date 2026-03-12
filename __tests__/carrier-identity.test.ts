/**
 * Tests for Carrier Identity — STIR/SHAKEN-inspired delivery authentication.
 *
 * Tests the open-standard protocol layer (carrier-identity.ts) and the
 * MoltUA verification layer (molt-ua.ts).
 *
 * Standards references:
 *   - STIR: RFC 8224 (Authenticated Identity Management in SIP)
 *   - SHAKEN: Signature-based Handling of Asserted information using toKENs
 *   - PASSporT: RFC 8225 (Personal Assertion Token)
 */

import {
  buildCarrierIdentityString,
  signCarrierDelivery,
  verifyCarrierIdentity,
  CARRIER_IDENTITY_HEADERS,
  type AttestationLevel,
} from '@moltprotocol/core';

import {
  verifyInboundDelivery,
  extractCarrierHeaders,
  type MoltUAConfig,
} from '@moltprotocol/core';

import { generateKeyPair } from '@moltprotocol/core';

// ── Test fixtures ────────────────────────────────────────

function makeCarrierKeys() {
  return generateKeyPair();
}

function makeMoltUAConfig(carrierPublicKey: string): MoltUAConfig {
  const agentKeys = generateKeyPair();
  return {
    moltNumber: 'TEST-AAAA-BBBB-CCCC-1',
    privateKey: agentKeys.privateKey,
    publicKey: agentKeys.publicKey,
    carrierPublicKey,
    carrierDomain: 'moltphone.ai',
    timestampWindowSeconds: 300,
  };
}

// ── Carrier Identity String ──────────────────────────────

describe('Carrier Identity — Canonical String', () => {
  it('builds canonical string with all fields joined by newlines', () => {
    const result = buildCarrierIdentityString({
      carrierDomain: 'moltphone.ai',
      attestation: 'A',
      origNumber: 'SOLR-AAAA-BBBB-CCCC-1',
      destNumber: 'LUNA-DDDD-EEEE-FFFF-2',
      timestamp: '1709337600',
      bodyHash: 'abc123def456',
    });
    const parts = result.split('\n');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('moltphone.ai');
    expect(parts[1]).toBe('A');
    expect(parts[2]).toBe('SOLR-AAAA-BBBB-CCCC-1');
    expect(parts[3]).toBe('LUNA-DDDD-EEEE-FFFF-2');
    expect(parts[4]).toBe('1709337600');
    expect(parts[5]).toBe('abc123def456');
  });

  it('uses "anonymous" for unknown callers', () => {
    const result = buildCarrierIdentityString({
      carrierDomain: 'moltphone.ai',
      attestation: 'C',
      origNumber: 'anonymous',
      destNumber: 'TEST-1111-2222-3333-4',
      timestamp: '1709337600',
      bodyHash: '0000',
    });
    expect(result).toContain('anonymous');
    expect(result).toContain('C');
  });
});

// ── Attestation Levels ───────────────────────────────────

describe('Carrier Identity — Attestation Levels (STIR/SHAKEN)', () => {
  const levels: AttestationLevel[] = ['A', 'B', 'C'];

  it('all three STIR/SHAKEN attestation levels are valid', () => {
    expect(levels).toHaveLength(3);
  });

  it('A = Full attestation (carrier verified caller Ed25519)', () => {
    // SHAKEN: originating carrier has verified the calling party
    expect(levels).toContain('A');
  });

  it('B = Partial attestation (registered but not signature-verified)', () => {
    expect(levels).toContain('B');
  });

  it('C = Gateway attestation (external / anonymous caller)', () => {
    expect(levels).toContain('C');
  });
});

// ── Sign + Verify Round Trip ─────────────────────────────

describe('Carrier Identity — Sign + Verify', () => {
  it('round-trip: sign delivery then verify succeeds', () => {
    const carrier = makeCarrierKeys();
    const body = '{"message":{"parts":[{"type":"text","text":"Hello"}]}}';

    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'SOLR-AAAA-BBBB-CCCC-1',
      destNumber: 'LUNA-DDDD-EEEE-FFFF-2',
      attestation: 'A',
      body,
      carrierPrivateKey: carrier.privateKey,
    });

    const result = verifyCarrierIdentity({
      signature: signed.signature,
      carrierDomain: 'moltphone.ai',
      attestation: signed.attestation,
      timestamp: signed.timestamp,
      origNumber: 'SOLR-AAAA-BBBB-CCCC-1',
      destNumber: 'LUNA-DDDD-EEEE-FFFF-2',
      body,
      carrierPublicKey: carrier.publicKey,
    });

    expect(result.valid).toBe(true);
    expect(result.attestation).toBe('A');
  });

  it('verification fails with wrong carrier key', () => {
    const carrier = makeCarrierKeys();
    const wrongCarrier = makeCarrierKeys();
    const body = '{"test": true}';

    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'SOLR-AAAA-BBBB-CCCC-1',
      destNumber: 'LUNA-DDDD-EEEE-FFFF-2',
      attestation: 'A',
      body,
      carrierPrivateKey: carrier.privateKey,
    });

    const result = verifyCarrierIdentity({
      signature: signed.signature,
      carrierDomain: 'moltphone.ai',
      attestation: 'A',
      timestamp: signed.timestamp,
      origNumber: 'SOLR-AAAA-BBBB-CCCC-1',
      destNumber: 'LUNA-DDDD-EEEE-FFFF-2',
      body,
      carrierPublicKey: wrongCarrier.publicKey,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('mismatch');
  });

  it('verification fails when body is tampered', () => {
    const carrier = makeCarrierKeys();
    const body = '{"message":"original"}';

    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'TEST-1111-2222-3333-4',
      destNumber: 'TEST-5555-6666-7777-8',
      attestation: 'B',
      body,
      carrierPrivateKey: carrier.privateKey,
    });

    const result = verifyCarrierIdentity({
      signature: signed.signature,
      carrierDomain: 'moltphone.ai',
      attestation: 'B',
      timestamp: signed.timestamp,
      origNumber: 'TEST-1111-2222-3333-4',
      destNumber: 'TEST-5555-6666-7777-8',
      body: '{"message":"tampered"}',
      carrierPublicKey: carrier.publicKey,
    });

    expect(result.valid).toBe(false);
  });

  it('verification fails when timestamp is out of window', () => {
    const carrier = makeCarrierKeys();
    const body = '{}';
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 600).toString();

    // Manually construct a signed delivery with an old timestamp
    const crypto = require('crypto');
    const bodyHash = crypto.createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [
      'moltphone.ai', 'A', 'ORIG-1', 'DEST-2', oldTimestamp, bodyHash,
    ].join('\n');
    const pkDer = Buffer.from(carrier.privateKey, 'base64url');
    const privateKeyObj = crypto.createPrivateKey({ key: pkDer, format: 'der', type: 'pkcs8' });
    const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyObj);

    const result = verifyCarrierIdentity({
      signature: sig.toString('base64url'),
      carrierDomain: 'moltphone.ai',
      attestation: 'A',
      timestamp: oldTimestamp,
      origNumber: 'ORIG-1',
      destNumber: 'DEST-2',
      body,
      carrierPublicKey: carrier.publicKey,
      windowSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toContain('timestamp');
  });

  it('attestation level is preserved through sign + verify', () => {
    const carrier = makeCarrierKeys();
    const body = '{}';

    for (const level of ['A', 'B', 'C'] as AttestationLevel[]) {
      const signed = signCarrierDelivery({
        carrierDomain: 'moltphone.ai',
        origNumber: 'O', destNumber: 'D',
        attestation: level, body,
        carrierPrivateKey: carrier.privateKey,
      });

      const result = verifyCarrierIdentity({
        signature: signed.signature,
        carrierDomain: 'moltphone.ai',
        attestation: level,
        timestamp: signed.timestamp,
        origNumber: 'O', destNumber: 'D',
        body, carrierPublicKey: carrier.publicKey,
      });

      expect(result.valid).toBe(true);
      expect(result.attestation).toBe(level);
    }
  });
});

// ── Header Constants ─────────────────────────────────────

describe('Carrier Identity — Header Names', () => {
  it('defines all required X-Molt-Identity headers', () => {
    expect(CARRIER_IDENTITY_HEADERS.SIGNATURE).toBe('X-Molt-Identity');
    expect(CARRIER_IDENTITY_HEADERS.CARRIER).toBe('X-Molt-Identity-Carrier');
    expect(CARRIER_IDENTITY_HEADERS.ATTESTATION).toBe('X-Molt-Identity-Attest');
    expect(CARRIER_IDENTITY_HEADERS.TIMESTAMP).toBe('X-Molt-Identity-Timestamp');
  });
});

// ── MoltUA Verification ──────────────────────────────────

describe('MoltUA — Inbound Delivery Verification', () => {
  it('accepts a valid carrier-signed delivery (Level 1 compliance)', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);
    const body = '{"message":"hello"}';

    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'CALLER-1234-5678-9ABC-D',
      destNumber: config.moltNumber,
      attestation: 'A',
      body,
      carrierPrivateKey: carrier.privateKey,
    });

    const headers = {
      'x-molt-identity': signed.signature,
      'x-molt-identity-carrier': 'moltphone.ai',
      'x-molt-identity-attest': signed.attestation,
      'x-molt-identity-timestamp': signed.timestamp,
    };

    const result = verifyInboundDelivery(config, headers, body, {
      origNumber: 'CALLER-1234-5678-9ABC-D',
    });

    expect(result.trusted).toBe(true);
    expect(result.carrierVerified).toBe(true);
    expect(result.attestation).toBe('A');
  });

  it('rejects requests without carrier identity in strict mode', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);

    const result = verifyInboundDelivery(config, {}, '{}', { strictMode: true });

    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('Missing carrier identity');
  });

  it('accepts requests without carrier identity in non-strict mode', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);

    const result = verifyInboundDelivery(config, {}, '{}', { strictMode: false });

    expect(result.trusted).toBe(true);
    expect(result.carrierVerified).toBe(false);
  });

  it('rejects carrier domain mismatch', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);
    const body = '{}';

    const signed = signCarrierDelivery({
      carrierDomain: 'evil-carrier.com',
      origNumber: 'anonymous',
      destNumber: config.moltNumber,
      attestation: 'C',
      body,
      carrierPrivateKey: carrier.privateKey,
    });

    const headers = {
      'x-molt-identity': signed.signature,
      'x-molt-identity-carrier': 'evil-carrier.com',
      'x-molt-identity-attest': 'C',
      'x-molt-identity-timestamp': signed.timestamp,
    };

    const result = verifyInboundDelivery(config, headers, body);
    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('domain mismatch');
  });

  it('rejects forged signature (leaked endpoint attack)', () => {
    const realCarrier = makeCarrierKeys();
    const attackerKeys = makeCarrierKeys();
    const config = makeMoltUAConfig(realCarrier.publicKey);
    const body = '{"malicious": true}';

    // Attacker knows the endpoint URL but signs with their own key
    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'ATTACKER-1',
      destNumber: config.moltNumber,
      attestation: 'A',
      body,
      carrierPrivateKey: attackerKeys.privateKey,
    });

    const headers = {
      'x-molt-identity': signed.signature,
      'x-molt-identity-carrier': 'moltphone.ai',
      'x-molt-identity-attest': 'A',
      'x-molt-identity-timestamp': signed.timestamp,
    };

    const result = verifyInboundDelivery(config, headers, body, {
      origNumber: 'ATTACKER-1',
    });

    expect(result.trusted).toBe(false);
    expect(result.reason).toContain('mismatch');
  });
});

// ── Helper: extractCarrierHeaders ────────────────────────

describe('MoltUA — extractCarrierHeaders', () => {
  it('extracts headers by their canonical names', () => {
    const mockGetHeader = (name: string): string | null => {
      const map: Record<string, string> = {
        'X-Molt-Identity': 'sig123',
        'X-Molt-Identity-Carrier': 'moltphone.ai',
        'X-Molt-Identity-Attest': 'A',
        'X-Molt-Identity-Timestamp': '1709337600',
        'X-Molt-Target': 'agent-id',
      };
      return map[name] ?? null;
    };

    const headers = extractCarrierHeaders(mockGetHeader);
    expect(headers['x-molt-identity']).toBe('sig123');
    expect(headers['x-molt-identity-carrier']).toBe('moltphone.ai');
    expect(headers['x-molt-identity-attest']).toBe('A');
    expect(headers['x-molt-identity-timestamp']).toBe('1709337600');
    expect(headers['x-molt-target']).toBe('agent-id');
  });

  it('returns null for missing headers', () => {
    const headers = extractCarrierHeaders(() => null);
    expect(headers['x-molt-identity']).toBeNull();
    expect(headers['x-molt-identity-carrier']).toBeNull();
  });
});

// ── Defense-in-Depth Properties ──────────────────────────

describe('MoltUA — Security Properties', () => {
  it('Layer 1: leaked endpoint is unexploitable without carrier key', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);

    // Scenario: attacker finds endpoint URL and sends a raw request
    // (no carrier identity headers)
    const result = verifyInboundDelivery(config, {}, '{"attack": true}', {
      strictMode: true,
    });
    expect(result.trusted).toBe(false);
  });

  it('carrier signature is body-bound (prevents request tampering)', () => {
    const carrier = makeCarrierKeys();
    const config = makeMoltUAConfig(carrier.publicKey);
    const originalBody = '{"safe": true}';
    const tamperedBody = '{"safe": false, "inject": "malicious"}';

    const signed = signCarrierDelivery({
      carrierDomain: 'moltphone.ai',
      origNumber: 'CALLER-1',
      destNumber: config.moltNumber,
      attestation: 'A',
      body: originalBody,
      carrierPrivateKey: carrier.privateKey,
    });

    const headers = {
      'x-molt-identity': signed.signature,
      'x-molt-identity-carrier': 'moltphone.ai',
      'x-molt-identity-attest': 'A',
      'x-molt-identity-timestamp': signed.timestamp,
    };

    // Verify original body works
    const ok = verifyInboundDelivery(config, headers, originalBody, { origNumber: 'CALLER-1' });
    expect(ok.trusted).toBe(true);

    // Verify tampered body fails
    const tampered = verifyInboundDelivery(config, headers, tamperedBody, { origNumber: 'CALLER-1' });
    expect(tampered.trusted).toBe(false);
  });
});
