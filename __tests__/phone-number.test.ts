import {
  generatePhoneNumber,
  verifyPhoneNumber,
  validatePhoneNumber,
  normalizePhoneNumber,
  parsePhoneNumber,
  deriveSubscriber,
  CROCKFORD_ALPHABET,
} from '../lib/phone-number';
import { generateKeyPair } from '../lib/ed25519';

describe('Self-Certifying MoltNumber (carrier shim)', () => {
  it('generates valid phone numbers without + prefix', () => {
    for (let i = 0; i < 10; i++) {
      const kp = generateKeyPair();
      const num = generatePhoneNumber('MOLT', kp.publicKey);
      expect(validatePhoneNumber(num)).toBe(true);
      // Self-certifying format: NATION-AAAA-BBBB-CCCC-DDDD (no check digit)
      expect(num).toMatch(/^MOLT-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
  });

  it('generates unique phone numbers for unique keys', () => {
    const nums = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const kp = generateKeyPair();
      nums.add(generatePhoneNumber('MOLT', kp.publicKey));
    }
    expect(nums.size).toBe(100);
  });

  it('same key always produces same number', () => {
    const kp = generateKeyPair();
    const num1 = generatePhoneNumber('MOLT', kp.publicKey);
    const num2 = generatePhoneNumber('MOLT', kp.publicKey);
    expect(num1).toBe(num2);
  });

  it('validates correct phone number', () => {
    const kp = generateKeyPair();
    const num = generatePhoneNumber('AION', kp.publicKey);
    expect(validatePhoneNumber(num)).toBe(true);
  });

  it('rejects invalid format', () => {
    // Old format with check digit (too short)
    expect(validatePhoneNumber('MOLT-1234-5678-9012-3')).toBe(false);
    // + prefix is not valid
    expect(validatePhoneNumber('+MOLT-1234-5678-9012-3456')).toBe(false);
    // Nation code must be exactly 4 uppercase letters
    expect(validatePhoneNumber('MOL-1234-5678-9012-3456')).toBe(false);
  });

  it('self-certifying: verifyPhoneNumber confirms matching key', () => {
    const kp = generateKeyPair();
    const num = generatePhoneNumber('MOLT', kp.publicKey);
    expect(verifyPhoneNumber(num, kp.publicKey)).toBe(true);
  });

  it('self-certifying: verifyPhoneNumber rejects wrong key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const num = generatePhoneNumber('MOLT', kp1.publicKey);
    expect(verifyPhoneNumber(num, kp2.publicKey)).toBe(false);
  });

  it('normalizes phone numbers (uppercase, trimmed)', () => {
    expect(normalizePhoneNumber('  molt-1234-5678-9012-abcd  ')).toBe('MOLT-1234-5678-9012-ABCD');
  });

  it('parses phone number components', () => {
    const kp = generateKeyPair();
    const num = generatePhoneNumber('CLAW', kp.publicKey);
    const parsed = parsePhoneNumber(num);
    expect(parsed).not.toBeNull();
    expect(parsed!.nation).toBe('CLAW');
    expect(parsed!.subscriber).toHaveLength(16);
    expect(parsed!.formatted).toBe(num);
  });

  it('excludes ambiguous characters (I, L, O)', () => {
    for (let i = 0; i < 50; i++) {
      const kp = generateKeyPair();
      const num = generatePhoneNumber('MOLT', kp.publicKey);
      const subscriber = num.replace(/^MOLT-/, '').replace(/-/g, '');
      expect(subscriber).not.toMatch(/[ILO]/);
    }
  });

  it('throws for invalid nation code', () => {
    const kp = generateKeyPair();
    expect(() => generatePhoneNumber('MOL', kp.publicKey)).toThrow();
    expect(() => generatePhoneNumber('molt', kp.publicKey)).toThrow();
    expect(() => generatePhoneNumber('12AB', kp.publicKey)).toThrow();
  });

  it('is URL-safe (no + or special chars)', () => {
    for (let i = 0; i < 10; i++) {
      const kp = generateKeyPair();
      const num = generatePhoneNumber('AION', kp.publicKey);
      expect(num).not.toContain('+');
      expect(encodeURIComponent(num)).toBe(num);
    }
  });
});
