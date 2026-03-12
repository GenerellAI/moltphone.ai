/**
 * Nation Delegation Service — manages delegation certificates for org/carrier nations.
 *
 * A delegation certificate proves that a nation owner (org or carrier type)
 * authorized a specific carrier to manage agents under their nation code.
 *
 * Trust chain with delegation:
 *   Root → Carrier cert → Delegation cert → Registration cert → Agent
 *
 * This service handles:
 *   - Nation Ed25519 keypair generation (public key stored on Nation model)
 *   - Delegation creation (nation owner signs cert for a carrier)
 *   - Delegation revocation
 *   - Delegation verification (used by agent creation enforcement)
 *   - Querying delegations for a nation
 */

import { prisma } from '@/lib/prisma';
import { generateKeyPair } from '@moltprotocol/core';
import {
  signDelegationCertificate,
  verifyDelegationCertificate,
  type DelegationCertificate,
} from '@moltprotocol/core';
import { getCarrierPublicKey, CARRIER_DOMAIN } from '@/lib/carrier-identity';
import type { DelegationCertificateJSON } from '@moltprotocol/core';

// ── Nation Keypair Management ────────────────────────────

/**
 * Generate a new Ed25519 keypair for a nation.
 *
 * Stores the public key on the Nation model. The private key is returned
 * ONCE (like MoltSIM provisioning). Re-generating rotates the key and
 * invalidates all existing delegation certificates.
 *
 * @returns The keypair (public key stored, private key shown once).
 */
export async function generateNationKeypair(nationCode: string) {
  const keyPair = generateKeyPair();

  await prisma.nation.update({
    where: { code: nationCode },
    data: { publicKey: keyPair.publicKey },
  });

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  };
}

// ── Delegation CRUD ──────────────────────────────────────

export interface CreateDelegationParams {
  nationCode: string;
  /** Nation owner's Ed25519 private key (base64url PKCS#8 DER). */
  nationPrivateKey: string;
  /** Carrier domain to authorize. Defaults to this carrier's domain. */
  carrierDomain?: string;
  /** Carrier public key. Defaults to this carrier's public key. */
  carrierPublicKey?: string;
  /** Optional expiry time (unix seconds). Omit for no expiry. */
  expiresAt?: number;
}

/**
 * Create a delegation certificate — nation owner authorizes a carrier.
 *
 * Steps:
 * 1. Look up nation's public key.
 * 2. Sign the delegation certificate with the nation's private key.
 * 3. Verify the certificate (ensures private/public key match).
 * 4. Upsert the NationDelegation record.
 */
export async function createDelegation(params: CreateDelegationParams) {
  const { nationCode, nationPrivateKey, expiresAt } = params;
  const carrierDomain = params.carrierDomain ?? CARRIER_DOMAIN;
  const carrierPublicKey = params.carrierPublicKey ?? getCarrierPublicKey();

  // Look up nation to get its public key
  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { publicKey: true, type: true },
  });

  if (!nation) throw new Error('Nation not found');
  if (!nation.publicKey) throw new Error('Nation has no public key. Generate a keypair first.');
  if (nation.type !== 'org' && nation.type !== 'carrier') {
    throw new Error('Delegation certificates are only for org or carrier nations');
  }

  const now = Math.floor(Date.now() / 1000);

  // Sign the delegation certificate
  const cert = signDelegationCertificate({
    nationCode,
    nationPublicKey: nation.publicKey,
    carrierDomain,
    carrierPublicKey,
    issuedAt: now,
    expiresAt,
    nationPrivateKey,
  });

  // Verify the cert to ensure the private key matches the stored public key
  const verification = verifyDelegationCertificate(cert, nation.publicKey);
  if (!verification.valid) {
    throw new Error(`Delegation signing failed: ${verification.reason}`);
  }

  // Upsert — one delegation per (nationCode, carrierDomain) pair
  const delegation = await prisma.nationDelegation.upsert({
    where: {
      nationCode_carrierDomain: { nationCode, carrierDomain },
    },
    create: {
      nationCode,
      carrierDomain,
      carrierPublicKey,
      signature: cert.signature,
      issuedAt: new Date(now * 1000),
      expiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
    },
    update: {
      carrierPublicKey,
      signature: cert.signature,
      issuedAt: new Date(now * 1000),
      expiresAt: expiresAt ? new Date(expiresAt * 1000) : null,
      revokedAt: null, // Clear any previous revocation
    },
  });

  return { delegation, certificate: cert };
}

/**
 * Revoke a delegation — carrier is no longer authorized.
 */
export async function revokeDelegation(nationCode: string, carrierDomain: string) {
  return prisma.nationDelegation.update({
    where: {
      nationCode_carrierDomain: { nationCode, carrierDomain },
    },
    data: { revokedAt: new Date() },
  });
}

/**
 * List all delegations for a nation (active and revoked).
 */
export async function listDelegations(nationCode: string) {
  return prisma.nationDelegation.findMany({
    where: { nationCode },
    orderBy: { issuedAt: 'desc' },
  });
}

/**
 * Get the active delegation for a specific nation + carrier pair.
 * Returns null if no active (non-revoked, non-expired) delegation exists.
 */
export async function getActiveDelegation(
  nationCode: string,
  carrierDomain?: string,
): Promise<DelegationCertificate | null> {
  const domain = carrierDomain ?? CARRIER_DOMAIN;

  const delegation = await prisma.nationDelegation.findUnique({
    where: {
      nationCode_carrierDomain: { nationCode, carrierDomain: domain },
    },
    include: {
      nation: { select: { publicKey: true } },
    },
  });

  if (!delegation) return null;
  if (delegation.revokedAt) return null;
  if (delegation.expiresAt && delegation.expiresAt < new Date()) return null;
  if (!delegation.nation.publicKey) return null;

  return {
    version: '1',
    nationCode: delegation.nationCode,
    nationPublicKey: delegation.nation.publicKey,
    carrierDomain: delegation.carrierDomain,
    carrierPublicKey: delegation.carrierPublicKey,
    signature: delegation.signature,
    issuedAt: Math.floor(delegation.issuedAt.getTime() / 1000),
    expiresAt: delegation.expiresAt
      ? Math.floor(delegation.expiresAt.getTime() / 1000)
      : undefined,
  };
}

// ── Delegation Enforcement ───────────────────────────────

/**
 * Check if a carrier is authorized to register agents under a nation.
 *
 * Enforcement rules by nation type:
 *   - `open`: Always allowed. No delegation needed.
 *   - `carrier`: Only the carrier that owns the nation. Checked via Nation.ownerId.
 *   - `org`: Requires a valid delegation certificate for this carrier.
 *
 * @returns `{ ok: true }` if allowed, `{ ok: false, reason: string }` if denied.
 */
export async function checkDelegation(
  nationCode: string,
  carrierDomain?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const domain = carrierDomain ?? CARRIER_DOMAIN;

  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { type: true, publicKey: true },
  });

  if (!nation) return { ok: false, reason: 'Nation not found' };

  // Open nations — always allowed, no delegation needed
  if (nation.type === 'open') return { ok: true };

  // Carrier nations — the existing ownerId check in the route handles this.
  // But for cross-carrier use, we'd also check delegation. For now, carrier
  // nations only work on the owning carrier (enforced at the route level).
  if (nation.type === 'carrier') {
    // Carrier nations are restricted to the owning carrier.
    // The delegation mechanism lets a carrier nation explicitly authorize
    // another carrier, but this is uncommon.
    const delegation = await getActiveDelegation(nationCode, domain);
    if (delegation) return { ok: true };

    // For carrier nations on this carrier, the route-level ownerId check
    // is sufficient. We return ok here since this check is supplementary.
    return { ok: true };
  }

  // Org nations — require a valid delegation certificate
  if (nation.type === 'org') {
    if (!nation.publicKey) {
      return {
        ok: false,
        reason: 'Org nation has no public key. The nation owner must generate a keypair and issue a delegation certificate.',
      };
    }

    const delegation = await getActiveDelegation(nationCode, domain);
    if (!delegation) {
      return {
        ok: false,
        reason: `No active delegation from nation ${nationCode} to carrier ${domain}. The nation owner must issue a delegation certificate.`,
      };
    }

    // Verify the delegation's signature
    const result = verifyDelegationCertificate(delegation, nation.publicKey, {
      expectedNationCode: nationCode,
      expectedCarrierDomain: domain,
    });

    if (!result.valid) {
      return {
        ok: false,
        reason: `Delegation certificate invalid: ${result.reason}`,
      };
    }

    return { ok: true };
  }

  return { ok: false, reason: `Unknown nation type: ${nation.type}` };
}

// ── JSON Serialization ───────────────────────────────────

/**
 * Convert a DelegationCertificate to the JSON wire format.
 */
export function delegationCertToJSON(cert: DelegationCertificate): DelegationCertificateJSON {
  return {
    version: cert.version,
    nation_code: cert.nationCode,
    nation_public_key: cert.nationPublicKey,
    carrier_domain: cert.carrierDomain,
    carrier_public_key: cert.carrierPublicKey,
    issued_at: cert.issuedAt,
    expires_at: cert.expiresAt,
    signature: cert.signature,
  };
}
