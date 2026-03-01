import {
  generateMoltNumber,
  validateMoltNumber,
  normalizeMoltNumber,
  parseMoltNumber,
  computeCheckDigit,
  CROCKFORD_ALPHABET,
} from '../src/format';

import {
  generateDomainClaimToken,
  buildWellKnownUrl,
  parseWellKnownFile,
  validateDomainClaim,
} from '../src/domain-binding';

// ── MoltNumber Format ────────────────────────────────────

describe('MoltNumber Format', () => {
  it('generates valid numbers without + prefix', () => {
    const num = generateMoltNumber('MOLT');
    expect(num).toMatch(/^MOLT-/);
    expect(num).not.toContain('+');
    expect(validateMoltNumber(num)).toBe(true);
  });

  it('is URL-safe (encodeURIComponent is identity)', () => {
    for (let i = 0; i < 30; i++) {
      const num = generateMoltNumber('AION');
      expect(encodeURIComponent(num)).toBe(num);
    }
  });

  it('uses Crockford Base32 for subscriber (no I, L, O)', () => {
    for (let i = 0; i < 50; i++) {
      const num = generateMoltNumber('MOLT');
      const parts = parseMoltNumber(num)!;
      expect(parts.subscriber).not.toMatch(/[ILO]/);
    }
  });

  it('stores uppercase only', () => {
    const num = generateMoltNumber('CLAW');
    expect(num).toBe(num.toUpperCase());
  });

  it('generates unique numbers', () => {
    const nums = new Set<string>();
    for (let i = 0; i < 100; i++) nums.add(generateMoltNumber('MOLT'));
    expect(nums.size).toBe(100);
  });

  it('check digit detects single-char tampering', () => {
    const num = generateMoltNumber('MOLT');
    const last = num[num.length - 1];
    const alt = CROCKFORD_ALPHABET.split('').find(c => c !== last)!;
    expect(validateMoltNumber(num.slice(0, -1) + alt)).toBe(false);
  });

  it('parseMoltNumber returns correct parts', () => {
    const num = generateMoltNumber('AION');
    const parts = parseMoltNumber(num);
    expect(parts).not.toBeNull();
    expect(parts!.nation).toBe('AION');
    expect(parts!.subscriber).toHaveLength(12);
    expect(parts!.checkDigit).toHaveLength(1);
    expect(parts!.formatted).toBe(num);
  });

  it('normalizeMoltNumber trims and uppercases', () => {
    expect(normalizeMoltNumber('  molt-aaaa-bbbb-cccc-0  ')).toBe('MOLT-AAAA-BBBB-CCCC-0');
  });

  it('rejects + prefixed numbers', () => {
    const num = generateMoltNumber('MOLT');
    expect(validateMoltNumber('+' + num)).toBe(false);
  });

  it('rejects invalid formats', () => {
    expect(validateMoltNumber('MOLT-XXXX-YYYY-ZZZZ-0')).toBe(false);
    expect(validateMoltNumber('+MOLT-1234-5678-9012-3')).toBe(false);
    expect(validateMoltNumber('MOL-1234-5678-9012-3')).toBe(false);
    expect(validateMoltNumber('MOLT-1234-5678-9012')).toBe(false);
  });

  it('throws for invalid nation code', () => {
    expect(() => generateMoltNumber('MOL')).toThrow();
    expect(() => generateMoltNumber('molt')).toThrow();
    expect(() => generateMoltNumber('12AB')).toThrow();
  });
});

// ── Domain Binding ──────────────────────────────────────

describe('Domain Binding', () => {
  it('generates 64-char hex token', () => {
    const token = generateDomainClaimToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('builds well-known URL from bare domain', () => {
    expect(buildWellKnownUrl('example.com')).toBe('https://example.com/.well-known/moltnumber.txt');
  });

  it('strips protocol and trailing slash', () => {
    expect(buildWellKnownUrl('https://example.com/')).toBe('https://example.com/.well-known/moltnumber.txt');
    expect(buildWellKnownUrl('http://example.com///')).toBe('https://example.com/.well-known/moltnumber.txt');
  });

  it('parses well-known file contents', () => {
    const body = 'moltnumber: MOLT-1234-5678-9012-A\ntoken: abc123';
    const parsed = parseWellKnownFile(body);
    expect(parsed.moltnumber).toBe('MOLT-1234-5678-9012-A');
    expect(parsed.token).toBe('abc123');
  });

  it('handles blank lines and whitespace', () => {
    const body = '\n  moltnumber:  AION-AAAA-BBBB-CCCC-0  \n\n  token:  mytoken  \n';
    const parsed = parseWellKnownFile(body);
    expect(parsed.moltnumber).toBe('AION-AAAA-BBBB-CCCC-0');
    expect(parsed.token).toBe('mytoken');
  });

  it('returns null for missing fields', () => {
    expect(parseWellKnownFile('nothing here')).toEqual({ moltnumber: null, token: null });
    expect(parseWellKnownFile('moltnumber: X')).toEqual({ moltnumber: 'X', token: null });
  });

  it('validates matching claim', () => {
    const mn = 'MOLT-1234-5678-9012-A';
    const token = 'abc123';
    const body = `moltnumber: ${mn}\ntoken: ${token}`;
    const result = validateDomainClaim(body, mn, token);
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('rejects MoltNumber mismatch', () => {
    const body = 'moltnumber: MOLT-AAAA-BBBB-CCCC-0\ntoken: tok';
    const result = validateDomainClaim(body, 'MOLT-XXXX-YYYY-ZZZZ-0', 'tok');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('MoltNumber mismatch');
  });

  it('rejects token mismatch', () => {
    const mn = 'MOLT-1234-5678-9012-A';
    const body = `moltnumber: ${mn}\ntoken: wrong`;
    const result = validateDomainClaim(body, mn, 'correct');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Token mismatch');
  });

  it('rejects missing moltnumber field', () => {
    const result = validateDomainClaim('token: abc', 'MOLT-1234-5678-9012-A', 'abc');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing moltnumber');
  });

  it('rejects missing token field', () => {
    const result = validateDomainClaim('moltnumber: MOLT-1234-5678-9012-A', 'MOLT-1234-5678-9012-A', 'abc');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('Missing token');
  });
});
