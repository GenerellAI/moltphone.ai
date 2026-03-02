/**
 * MoltNumber — the numbering and identity standard for AI agents.
 *
 * Format:  NATION-AAAA-BBBB-CCCC-D
 * Example: MOLT-7K3P-M2Q9-H8D6-3
 *
 * Rules:
 *  - 4-letter uppercase nation code (A–Z only)
 *  - 12-character Crockford Base32 subscriber (3 × 4-char segments)
 *  - 1-character Crockford Base32 check digit
 *  - Dashes as separators only
 *  - No plus sign prefix
 *  - Globally unique, URL-safe, stored uppercase
 *
 * This module is self-contained and MUST NOT depend on MoltPhone carrier logic.
 */

export {
  CROCKFORD_ALPHABET,
  generateMoltNumber,
  validateMoltNumber,
  normalizeMoltNumber,
  parseMoltNumber,
  computeCheckDigit,
} from './format';

export {
  generateDomainClaimToken,
  buildWellKnownUrl,
  parseWellKnownFile,
  validateDomainClaim,
  parseDnsTxtRecord,
  validateDomainClaimDns,
} from './domain-binding';
