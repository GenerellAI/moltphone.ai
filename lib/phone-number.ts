export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function randomCrockfordChar(): string {
  const idx = Math.floor(Math.random() * CROCKFORD_ALPHABET.length);
  return CROCKFORD_ALPHABET[idx];
}

export function randomCrockfordSegment(len: number): string {
  let s = '';
  for (let i = 0; i < len; i++) s += randomCrockfordChar();
  return s;
}

export function computeCheckDigit(subscriber: string): string {
  const clean = subscriber.replace(/-/g, '').toUpperCase();
  let sum = 0;
  for (let i = 0; i < clean.length; i++) {
    const val = CROCKFORD_ALPHABET.indexOf(clean[i]);
    if (val === -1) throw new Error(`Invalid char: ${clean[i]}`);
    sum += (i % 2 === 0) ? val : val * 2;
  }
  const checkVal = (CROCKFORD_ALPHABET.length - (sum % CROCKFORD_ALPHABET.length)) % CROCKFORD_ALPHABET.length;
  return CROCKFORD_ALPHABET[checkVal];
}

export function generatePhoneNumber(nationCode: string): string {
  if (!/^[A-Z]{4}$/.test(nationCode)) throw new Error('Nation code must be 4 uppercase letters');
  const nation = nationCode;
  
  const seg1 = randomCrockfordSegment(4);
  const seg2 = randomCrockfordSegment(4);
  const seg3 = randomCrockfordSegment(4);
  const subscriber = seg1 + seg2 + seg3;
  const check = computeCheckDigit(subscriber);
  
  return `+${nation}-${seg1}-${seg2}-${seg3}-${check}`;
}

export function validatePhoneNumber(phone: string): boolean {
  const pattern = /^\+([A-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/;
  const m = phone.match(pattern);
  if (!m) return false;
  const subscriber = m[2] + m[3] + m[4];
  const expected = computeCheckDigit(subscriber);
  return m[5] === expected;
}

export function normalizePhoneNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

export function parsePhoneNumber(phone: string): { nation: string; subscriber: string; checkDigit: string } | null {
  const pattern = /^\+([A-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/;
  const m = phone.match(pattern);
  if (!m) return null;
  return { nation: m[1], subscriber: m[2] + m[3] + m[4], checkDigit: m[5] };
}
