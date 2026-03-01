import {
  generatePhoneNumber,
  validatePhoneNumber,
  normalizePhoneNumber,
  parsePhoneNumber,
  computeCheckDigit,
  CROCKFORD_ALPHABET,
} from '../lib/phone-number';

describe('Phone Numbering Plan', () => {
  it('generates valid phone numbers', () => {
    for (let i = 0; i < 20; i++) {
      const num = generatePhoneNumber('MOLT');
      expect(validatePhoneNumber(num)).toBe(true);
      expect(num).toMatch(/^\+MOLT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
    }
  });

  it('generates unique phone numbers', () => {
    const nums = new Set<string>();
    for (let i = 0; i < 100; i++) nums.add(generatePhoneNumber('MOLT'));
    expect(nums.size).toBe(100);
  });

  it('validates correct phone number', () => {
    const num = generatePhoneNumber('AION');
    expect(validatePhoneNumber(num)).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(validatePhoneNumber('+MOLT-XXXX-YYYY-ZZZZ-0')).toBe(false);
    expect(validatePhoneNumber('MOLT-1234-5678-9012-3')).toBe(false);
    expect(validatePhoneNumber('+MOL-1234-5678-9012-3')).toBe(false);
    expect(validatePhoneNumber('+MOLT-1234-5678-9012')).toBe(false);
  });

  it('rejects wrong check digit', () => {
    const num = generatePhoneNumber('MOLT');
    const lastChar = num[num.length - 1];
    const badChar = CROCKFORD_ALPHABET.split('').find(c => c !== lastChar)!;
    const tampered = num.slice(0, -1) + badChar;
    expect(validatePhoneNumber(tampered)).toBe(false);
  });

  it('normalizes phone numbers', () => {
    expect(normalizePhoneNumber('  +molt-1234-5678-9012-3  ')).toBe('+MOLT-1234-5678-9012-3');
  });

  it('parses phone number components', () => {
    const num = generatePhoneNumber('CLAW');
    const parsed = parsePhoneNumber(num);
    expect(parsed).not.toBeNull();
    expect(parsed!.nation).toBe('CLAW');
    expect(parsed!.subscriber).toHaveLength(12);
    expect(parsed!.checkDigit).toHaveLength(1);
  });

  it('excludes ambiguous characters (I, L, O)', () => {
    for (let i = 0; i < 200; i++) {
      const num = generatePhoneNumber('MOLT');
      const subscriber = num.replace(/\+MOLT-/, '').replace(/-/g, '');
      expect(subscriber).not.toMatch(/[ILO]/);
    }
  });

  it('throws for invalid nation code', () => {
    expect(() => generatePhoneNumber('MOL')).toThrow();
    expect(() => generatePhoneNumber('molt')).toThrow();
    expect(() => generatePhoneNumber('12AB')).toThrow();
  });
});
