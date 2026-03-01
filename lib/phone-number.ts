/**
 * Compatibility shim — re-exports from the canonical MoltNumber module.
 *
 * MoltPhone (the carrier) imports MoltNumber (the numbering standard).
 * MoltNumber must not depend on MoltPhone.
 */

export {
  CROCKFORD_ALPHABET,
  computeCheckDigit,
  generateMoltNumber as generatePhoneNumber,
  validateMoltNumber as validatePhoneNumber,
  normalizeMoltNumber as normalizePhoneNumber,
  parseMoltNumber as parsePhoneNumber,
} from '../core/moltnumber/src';

