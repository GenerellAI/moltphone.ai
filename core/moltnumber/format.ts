/**
 * MoltNumber format — generation, validation, normalization, parsing.
 *
 * Format:  NATION-AAAA-BBBB-CCCC-D
 *  - NATION = 4 uppercase letters (A-Z)
 *  - AAAA-BBBB-CCCC = 12-char Crockford Base32 subscriber
 *  - D = Crockford Base32 check digit
 *
 * No plus sign. Dashes only. Stored uppercase.
 */

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ── Generation ──────────────────────────────────────────

function randomCrockfordChar(): string {
  const idx = Math.floor(Math.random() * CROCKFORD_ALPHABET.length);
  return CROCKFORD_ALPHABET[idx];
}

function randomCrockfordSegment(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += randomCrockfordChar();
  return s;
}

export function computeCheckDigit(subscriber: string): string {
  const clean = subscriber.replace(/-/g, '').toUpperCase();
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    const val = CROCKFORD_ALPHABET.indexOf(clean[i]);
    if (val === -1) throw new Error(`Invalid Crockford character: ${clean[i]}`);
    sum += i % 2 === 0 ? val : val * 2;
  }
  const checkVal = (CROCKFORD_ALPHABET.length - (sum % CROCKFORD_ALPHABET.length)) % CROCKFORD_ALPHABET.length;
  return CROCKFORD_ALPHABET[checkVal];
}

export function generateMoltNumber(nationCode: string): string {
  if (!/^[A-Z]{4}$/.test(nationCode)) {
    throw new Error('Nation code must be exactly 4 uppercase letters (A-Z)');
  }
  const seg1 = randomCrockfordSegment(4);
  const seg2 = randomCrockfordSegment(4);
  const seg3 = randomCrockfordSegment(4);
  const subscriber = seg1 + seg2 + seg3;
  const check = computeCheckDigit(subscriber);
  return `${nationCode}-${seg1}-${seg2}-${seg3}-${check}`;
}

// ── Validation ──────────────────────────────────────────

/** Full regex for a valid MoltNumber (no plus sign). */
const MOLTNUMBER_PATTERN =
  /^([A-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/;

export function validateMoltNumber(number: string): boolean {
  const m = number.match(MOLTNUMBER_PATTERN);
  if (!m) return false;
  const subscriber = m[2] + m[3] + m[4];
  const expected = computeCheckDigit(subscriber);
  return m[5] === expected;
}

// ── Normalization ───────────────────────────────────────

export function normalizeMoltNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

// ── Parsing ─────────────────────────────────────────────

export interface MoltNumberParts {
  nation: string;
  subscriber: string;
  checkDigit: string;
  /** The full formatted MoltNumber string. */
  formatted: string;
}

export function parseMoltNumber(number: string): MoltNumberParts | null {
  const m = number.match(MOLTNUMBER_PATTERN);
  if (!m) return null;
  return {
    nation: m[1],
    subscriber: m[2] + m[3] + m[4],
    checkDigit: m[5],
    formatted: m[0],
  };
}
