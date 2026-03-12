/**
 * Compatibility shim — re-exports from the canonical MoltNumber module.
 *
 * MoltPhone (the carrier) imports MoltNumber (the numbering standard).
 * MoltNumber must not depend on MoltPhone.
 */

export {
  CROCKFORD_ALPHABET,
  deriveSubscriber,
  generateMoltNumber,
  verifyMoltNumber,
  validateMoltNumber,
  normalizeMoltNumber,
  parseMoltNumber,
} from 'moltnumber';

