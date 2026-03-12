/**
 * MoltPhone.ai — Carrier Identity management.
 *
 * Manages three key layers of the MoltProtocol certificate chain:
 *
 *   Root (moltprotocol.org)  ──signs──▶  Carrier (moltphone.ai)  ──signs──▶  Agent
 *
 * Keys managed:
 *   1. Root keypair — signs carrier certificates. In production: ROOT_PRIVATE_KEY /
 *      ROOT_PUBLIC_KEY env vars. In dev: auto-generated and persisted.
 *   2. Carrier keypair — signs webhook deliveries + registration certificates.
 *      In production: CARRIER_PRIVATE_KEY / CARRIER_PUBLIC_KEY env vars.
 *      In dev: auto-generated and persisted.
 *   3. Carrier certificate — root-signed statement that this carrier is authorized.
 *      Generated once at startup, cached in memory.
 *
 * All keys are Ed25519, base64url-encoded DER (SPKI for public, PKCS#8 for private).
 */

import {
  signCarrierDelivery,
  type AttestationLevel,
  CARRIER_IDENTITY_HEADERS,
} from '@moltprotocol/core';
import {
  signCarrierCertificate,
  signRegistrationCertificate,
  type CarrierCertificate,
  type RegistrationCertificate,
} from '@moltprotocol/core';
import type { CarrierCertificateJSON, RegistrationCertificateJSON } from '@moltprotocol/core';
import { generateKeyPair } from '@moltprotocol/core';
import fs from 'node:fs';
import path from 'node:path';

// ── Constants ────────────────────────────────────────────

export const CARRIER_DOMAIN = process.env.CARRIER_DOMAIN || 'moltphone.ai';
const ROOT_ISSUER = process.env.ROOT_ISSUER || 'moltprotocol.org';
/** Carrier certificate validity: 1 year from issuance. */
const CARRIER_CERT_VALIDITY_SECONDS = 365 * 24 * 60 * 60;

// ── Root keypair (moltprotocol.org) ──────────────────────

const DEV_ROOT_KEYPAIR_FILE = path.join(process.cwd(), '.root-keypair.json');

let _rootPrivateKey: string;
let _rootPublicKey: string;

function ensureRootKeys() {
  if (_rootPrivateKey && _rootPublicKey) return;

  if (process.env.ROOT_PRIVATE_KEY && process.env.ROOT_PUBLIC_KEY) {
    _rootPrivateKey = process.env.ROOT_PRIVATE_KEY;
    _rootPublicKey = process.env.ROOT_PUBLIC_KEY;
  } else {
    // Development: persist keypair to disk so carrier certs survive restarts.
    try {
      const saved = JSON.parse(fs.readFileSync(DEV_ROOT_KEYPAIR_FILE, 'utf-8'));
      _rootPrivateKey = saved.privateKey;
      _rootPublicKey = saved.publicKey;
      console.log('[carrier-identity] Loaded dev root keypair from .root-keypair.json');
    } catch {
      console.warn(
        '[carrier-identity] ROOT_PRIVATE_KEY / ROOT_PUBLIC_KEY not set. ' +
        'Generating dev root keypair (persisted to .root-keypair.json).',
      );
      const kp = generateKeyPair();
      _rootPrivateKey = kp.privateKey;
      _rootPublicKey = kp.publicKey;
      try {
        fs.writeFileSync(
          DEV_ROOT_KEYPAIR_FILE,
          JSON.stringify({ privateKey: _rootPrivateKey, publicKey: _rootPublicKey }, null, 2) + '\n',
        );
      } catch (writeErr) {
        console.warn('[carrier-identity] Could not persist dev root keypair:', writeErr);
      }
    }
  }
}

/** Get the root authority's public key (base64url SPKI DER). */
export function getRootPublicKey(): string {
  ensureRootKeys();
  return _rootPublicKey;
}

// ── Carrier keypair ──────────────────────────────────────

const DEV_KEYPAIR_FILE = path.join(process.cwd(), '.carrier-keypair.json');

let _carrierPrivateKey: string;
let _carrierPublicKey: string;

function ensureCarrierKeys() {
  if (_carrierPrivateKey && _carrierPublicKey) return;

  if (process.env.CARRIER_PRIVATE_KEY && process.env.CARRIER_PUBLIC_KEY) {
    _carrierPrivateKey = process.env.CARRIER_PRIVATE_KEY;
    _carrierPublicKey = process.env.CARRIER_PUBLIC_KEY;
  } else {
    // Development: persist keypair to disk so it survives server restarts.
    // Without this, every restart generates a new key and invalidates all
    // existing MoltSIMs (carrier_public_key no longer matches).
    try {
      const saved = JSON.parse(fs.readFileSync(DEV_KEYPAIR_FILE, 'utf-8'));
      _carrierPrivateKey = saved.privateKey;
      _carrierPublicKey = saved.publicKey;
      console.log(
        '[carrier-identity] Loaded dev carrier keypair from .carrier-keypair.json',
      );
    } catch {
      console.warn(
        '[carrier-identity] CARRIER_PRIVATE_KEY / CARRIER_PUBLIC_KEY not set. ' +
        'Generating dev carrier keypair (persisted to .carrier-keypair.json).',
      );
      const kp = generateKeyPair();
      _carrierPrivateKey = kp.privateKey;
      _carrierPublicKey = kp.publicKey;
      try {
        fs.writeFileSync(
          DEV_KEYPAIR_FILE,
          JSON.stringify({ privateKey: _carrierPrivateKey, publicKey: _carrierPublicKey }, null, 2) + '\n',
        );
      } catch (writeErr) {
        console.warn('[carrier-identity] Could not persist dev keypair:', writeErr);
      }
    }
  }
}

/** Get the carrier's public key (base64url SPKI DER). Included in MoltSIM. */
export function getCarrierPublicKey(): string {
  ensureCarrierKeys();
  return _carrierPublicKey;
}

// ── Carrier certificate (root → carrier) ─────────────────

let _carrierCert: CarrierCertificate | null = null;

/**
 * Get the carrier certificate (root-signed). Loaded from one of:
 *
 *   1. CARRIER_CERTIFICATE env var — pre-signed JSON from root authority CLI.
 *      This is the production path. The cert is signed offline by the root
 *      authority (moltprotocol.org) using `scripts/root-authority.ts sign-carrier`.
 *
 *   2. Dev fallback — self-signed using the local root key (same as before).
 *      Only used when ROOT_PRIVATE_KEY is available and no CARRIER_CERTIFICATE
 *      is set.
 *
 * The pre-signed cert is validated on first load (expiry check). If expired,
 * falls through to self-signing (dev) or throws (production).
 */
export function getCarrierCertificate(): CarrierCertificate {
  // Return cached cert if still valid (with 1-hour buffer)
  const now = Math.floor(Date.now() / 1000);
  if (_carrierCert && _carrierCert.expiresAt > now + 3600) {
    return _carrierCert;
  }

  // Path 1: Pre-signed certificate from env var (production)
  if (process.env.CARRIER_CERTIFICATE) {
    try {
      const json = JSON.parse(process.env.CARRIER_CERTIFICATE);
      const cert: CarrierCertificate = {
        version: json.version || '1',
        carrierDomain: json.carrier_domain,
        carrierPublicKey: json.carrier_public_key,
        issuedAt: json.issued_at,
        expiresAt: json.expires_at,
        issuer: json.issuer,
        signature: json.signature,
      };

      if (cert.expiresAt <= now + 3600) {
        console.error(
          '[carrier-identity] CARRIER_CERTIFICATE is expired or expiring within 1 hour. ' +
          'Re-sign with: npx tsx scripts/root-authority.ts sign-carrier',
        );
        // Fall through to self-signing in dev, hard error in production
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Carrier certificate expired');
        }
      } else {
        console.log(
          `[carrier-identity] Loaded pre-signed carrier certificate ` +
          `(expires ${new Date(cert.expiresAt * 1000).toISOString()})`,
        );
        _carrierCert = cert;
        return _carrierCert;
      }
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Invalid CARRIER_CERTIFICATE: ${err}`);
      }
      console.warn('[carrier-identity] Could not parse CARRIER_CERTIFICATE, falling back to self-signing.');
    }
  }

  // Path 2: Self-sign using local root key (development only)
  ensureRootKeys();
  ensureCarrierKeys();

  _carrierCert = signCarrierCertificate({
    carrierDomain: CARRIER_DOMAIN,
    carrierPublicKey: _carrierPublicKey,
    issuedAt: now,
    expiresAt: now + CARRIER_CERT_VALIDITY_SECONDS,
    issuer: ROOT_ISSUER,
    rootPrivateKey: _rootPrivateKey,
  });

  return _carrierCert;
}

/** Get the carrier certificate as a JSON-serializable object. */
export function getCarrierCertificateJSON(): CarrierCertificateJSON {
  const cert = getCarrierCertificate();
  return {
    version: cert.version,
    carrier_domain: cert.carrierDomain,
    carrier_public_key: cert.carrierPublicKey,
    issued_at: cert.issuedAt,
    expires_at: cert.expiresAt,
    issuer: cert.issuer,
    signature: cert.signature,
  };
}

// ── Delivery signing ─────────────────────────────────────

export interface SignDeliveryParams {
  /** Caller MoltNumber, or "anonymous". */
  origNumber: string;
  /** Target MoltNumber. */
  destNumber: string;
  /** Raw request body being delivered. */
  body: string;
  /** Attestation level. 'A' if caller is Ed25519-verified. */
  attestation: AttestationLevel;
}

export interface SignedDeliveryHeaders {
  [CARRIER_IDENTITY_HEADERS.SIGNATURE]: string;
  [CARRIER_IDENTITY_HEADERS.CARRIER]: string;
  [CARRIER_IDENTITY_HEADERS.ATTESTATION]: string;
  [CARRIER_IDENTITY_HEADERS.TIMESTAMP]: string;
}

/**
 * Sign an outbound webhook delivery with the carrier's Ed25519 key.
 *
 * Returns the X-Molt-Identity-* headers to include in the webhook request.
 * The receiving MoltUA verifies these to confirm the delivery is authentic.
 */
export function signDelivery(params: SignDeliveryParams): SignedDeliveryHeaders {
  ensureCarrierKeys();

  const result = signCarrierDelivery({
    carrierDomain: CARRIER_DOMAIN,
    origNumber: params.origNumber,
    destNumber: params.destNumber,
    attestation: params.attestation,
    body: params.body,
    carrierPrivateKey: _carrierPrivateKey,
  });

  return {
    [CARRIER_IDENTITY_HEADERS.SIGNATURE]: result.signature,
    [CARRIER_IDENTITY_HEADERS.CARRIER]: CARRIER_DOMAIN,
    [CARRIER_IDENTITY_HEADERS.ATTESTATION]: result.attestation,
    [CARRIER_IDENTITY_HEADERS.TIMESTAMP]: result.timestamp,
  };
}

/**
 * Determine attestation level for a delivery based on caller verification.
 *
 * Follows STIR/SHAKEN attestation model:
 *   A = Caller is verified (Ed25519 signature checked, registered agent)
 *   B = Caller is registered but signature not verified (public policy)
 *   C = Caller is unknown / external / anonymous
 */
export function determineAttestation(opts: {
  callerVerified: boolean;
  callerRegistered: boolean;
}): AttestationLevel {
  if (opts.callerVerified) return 'A';
  if (opts.callerRegistered) return 'B';
  return 'C';
}

// ── Registration certificates ────────────────────────────

/**
 * Issue a registration certificate for an agent.
 *
 * Called at agent creation and MoltSIM re-provisioning. The certificate
 * proves (offline-verifiable) that this carrier registered the agent.
 *
 * Anyone with the carrier's public key can verify this certificate.
 * Combined with a carrier certificate from the root authority, the full
 * chain is: root → carrier → agent.
 */
export function issueRegistrationCertificate(params: {
  moltNumber: string;
  agentPublicKey: string;
  nationCode: string;
}): RegistrationCertificate {
  ensureCarrierKeys();
  return signRegistrationCertificate({
    moltNumber: params.moltNumber,
    agentPublicKey: params.agentPublicKey,
    nationCode: params.nationCode,
    carrierDomain: CARRIER_DOMAIN,
    issuedAt: Math.floor(Date.now() / 1000),
    carrierPrivateKey: _carrierPrivateKey,
  });
}

// ── JSON serialization helpers ───────────────────────────

/** Convert a RegistrationCertificate to its JSON-serializable form. */
export function registrationCertToJSON(cert: RegistrationCertificate): RegistrationCertificateJSON {
  return {
    version: cert.version,
    molt_number: cert.moltNumber,
    agent_public_key: cert.agentPublicKey,
    nation_code: cert.nationCode,
    carrier_domain: cert.carrierDomain,
    issued_at: cert.issuedAt,
    signature: cert.signature,
  };
}
