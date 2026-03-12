/**
 * Integration tests for /.well-known/molt-root.json and
 * /.well-known/molt-carrier.json endpoints.
 *
 * These are public, unauthenticated endpoints that serve
 * certificate chain data for offline trust verification.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Mocks ────────────────────────────────────────────────

const mockGetCarrierPublicKey = jest.fn().mockReturnValue('mock-carrier-public-key-b64url');
const mockGetRootPublicKey = jest.fn().mockReturnValue('mock-root-public-key-b64url');
const mockGetCarrierCertificateJSON = jest.fn().mockReturnValue({
  version: '1',
  carrier_domain: 'moltphone.ai',
  carrier_public_key: 'mock-carrier-public-key-b64url',
  issued_at: 1719936000,
  expires_at: 1751472000,
  issuer: 'moltprotocol.org',
  signature: 'mock-root-signature',
});

jest.mock('@/lib/carrier-identity', () => ({
  getCarrierPublicKey: () => mockGetCarrierPublicKey(),
  getRootPublicKey: () => mockGetRootPublicKey(),
  getCarrierCertificateJSON: () => mockGetCarrierCertificateJSON(),
  CARRIER_DOMAIN: 'moltphone.ai',
}));

// ── Import routes ────────────────────────────────────────

import { GET as getRootCert } from '../../app/.well-known/molt-root.json/route';
import { GET as getCarrierCert } from '../../app/.well-known/molt-carrier.json/route';

// ── Setup ────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
});

// ══════════════════════════════════════════════════════════
// ── GET /.well-known/molt-root.json ──────────────────────
// ══════════════════════════════════════════════════════════

describe('GET /.well-known/molt-root.json', () => {
  it('returns the root authority public key', async () => {
    const res = await getRootCert();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.version).toBe('1');
    expect(body.issuer).toBe('moltprotocol.org');
    expect(body.public_key).toBe('mock-root-public-key-b64url');
    expect(body.key_algorithm).toBe('Ed25519');
    expect(body.key_encoding).toBe('base64url SPKI DER');
  });

  it('includes proper cache headers', async () => {
    const res = await getRootCert();

    // Root cert changes very rarely — long cache
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('cache-control')).toContain('max-age=86400');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('uses ROOT_ISSUER from env if set', async () => {
    const originalEnv = process.env.ROOT_ISSUER;
    process.env.ROOT_ISSUER = 'custom-issuer.org';

    // Re-import to pick up env change — can't easily do this with jest cache,
    // but since the route reads env inline, it will use the env value
    const res = await getRootCert();
    const body = await res.json();

    // The route reads process.env.ROOT_ISSUER at request time
    expect(body.issuer).toBe('custom-issuer.org');

    process.env.ROOT_ISSUER = originalEnv;
  });
});

// ══════════════════════════════════════════════════════════
// ── GET /.well-known/molt-carrier.json ───────────────────
// ══════════════════════════════════════════════════════════

describe('GET /.well-known/molt-carrier.json', () => {
  it('returns the carrier certificate and public key', async () => {
    const res = await getCarrierCert();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.version).toBe('1');
    expect(body.carrier_domain).toBe('moltphone.ai');
    expect(body.carrier_public_key).toBe('mock-carrier-public-key-b64url');
    expect(body.key_algorithm).toBe('Ed25519');
    expect(body.key_encoding).toBe('base64url SPKI DER');
  });

  it('includes the carrier certificate (root-signed)', async () => {
    const res = await getCarrierCert();
    const body = await res.json();

    expect(body.certificate).toBeDefined();
    expect(body.certificate.version).toBe('1');
    expect(body.certificate.carrier_domain).toBe('moltphone.ai');
    expect(body.certificate.issuer).toBe('moltprotocol.org');
    expect(body.certificate.signature).toBeDefined();
    expect(body.certificate.issued_at).toBeDefined();
    expect(body.certificate.expires_at).toBeDefined();
  });

  it('includes proper cache headers', async () => {
    const res = await getCarrierCert();

    // Carrier cert — moderate cache (1 hour)
    expect(res.headers.get('cache-control')).toContain('public');
    expect(res.headers.get('cache-control')).toContain('max-age=3600');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('calls getCarrierPublicKey and getCarrierCertificateJSON', async () => {
    await getCarrierCert();

    expect(mockGetCarrierPublicKey).toHaveBeenCalledTimes(1);
    expect(mockGetCarrierCertificateJSON).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════
// ── Certificate chain coherence ──────────────────────────
// ══════════════════════════════════════════════════════════

describe('Certificate chain coherence', () => {
  it('carrier cert public key matches standalone carrier public key', async () => {
    const carrierRes = await getCarrierCert();
    const carrierBody = await carrierRes.json();

    expect(carrierBody.carrier_public_key).toBe(carrierBody.certificate.carrier_public_key);
  });

  it('both endpoints serve JSON content type', async () => {
    const rootRes = await getRootCert();
    const carrierRes = await getCarrierCert();

    expect(rootRes.headers.get('content-type')).toContain('application/json');
    expect(carrierRes.headers.get('content-type')).toContain('application/json');
  });

  it('root is discoverable from carrier cert issuer field', async () => {
    const carrierRes = await getCarrierCert();
    const carrierBody = await carrierRes.json();

    // Both the root endpoint and the carrier cert reference the same issuer
    expect(carrierBody.certificate.issuer).toBe('moltprotocol.org');
  });
});
