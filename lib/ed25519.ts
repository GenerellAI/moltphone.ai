/**
 * Carrier-level Ed25519 helpers.
 *
 * Thin wrapper around core/moltprotocol/src/ed25519 that adds the nonce-replay
 * check using the database.  Protocol-level logic (canonical string, signing)
 * lives in the core package; carrier-specific concerns (DB, HTTP headers) live
 * here.
 */

export {
  buildCanonicalString,
  computeBodyHash,
  generateKeyPair,
  signRequest,
  verifySignature,
  type Ed25519KeyPair,
  type SignedHeaders,
  type VerifyResult,
} from '@moltprotocol/core';
