/**
 * MoltPhone.ai — Carrier Identity management.
 *
 * Manages the carrier's Ed25519 keypair and provides a convenient
 * wrapper for signing outbound webhook deliveries with the
 * STIR/SHAKEN-inspired X-Molt-Identity headers.
 *
 * The carrier keypair is loaded from environment variables:
 *   CARRIER_PRIVATE_KEY — base64url-encoded PKCS#8 DER
 *   CARRIER_PUBLIC_KEY  — base64url-encoded SPKI DER
 *
 * If not set, a keypair is generated at startup (development only).
 * In production, these MUST be stable — rotating them invalidates all
 * existing MoltSIMs (clients can no longer verify deliveries).
 */

import {
  signCarrierDelivery,
  type AttestationLevel,
  CARRIER_IDENTITY_HEADERS,
} from '@/core/moltprotocol/src/carrier-identity';
import {
  signRegistrationCertificate,
  type RegistrationCertificate,
} from '@/core/moltprotocol/src/certificates';
import { generateKeyPair } from '@/core/moltprotocol/src/ed25519';

// ── Carrier keypair ──────────────────────────────────────

let _carrierPrivateKey: string;
let _carrierPublicKey: string;

function ensureCarrierKeys() {
  if (_carrierPrivateKey && _carrierPublicKey) return;

  if (process.env.CARRIER_PRIVATE_KEY && process.env.CARRIER_PUBLIC_KEY) {
    _carrierPrivateKey = process.env.CARRIER_PRIVATE_KEY;
    _carrierPublicKey = process.env.CARRIER_PUBLIC_KEY;
  } else {
    // Development: generate ephemeral keypair (not suitable for production)
    console.warn(
      '[carrier-identity] CARRIER_PRIVATE_KEY / CARRIER_PUBLIC_KEY not set. ' +
      'Generating ephemeral keypair (MoltSIM carrier_public_key will change on restart).',
    );
    const kp = generateKeyPair();
    _carrierPrivateKey = kp.privateKey;
    _carrierPublicKey = kp.publicKey;
  }
}

/** Get the carrier's public key (base64url SPKI DER). Included in MoltSIM. */
export function getCarrierPublicKey(): string {
  ensureCarrierKeys();
  return _carrierPublicKey;
}

export const CARRIER_DOMAIN = process.env.CARRIER_DOMAIN || 'moltphone.ai';

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
  phoneNumber: string;
  agentPublicKey: string;
  nationCode: string;
}): RegistrationCertificate {
  ensureCarrierKeys();
  return signRegistrationCertificate({
    phoneNumber: params.phoneNumber,
    agentPublicKey: params.agentPublicKey,
    nationCode: params.nationCode,
    carrierDomain: CARRIER_DOMAIN,
    issuedAt: Math.floor(Date.now() / 1000),
    carrierPrivateKey: _carrierPrivateKey,
  });
}
