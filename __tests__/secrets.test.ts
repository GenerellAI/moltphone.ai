import { generateSecret, hashSecret, verifySecret, constantTimeEqual } from '../lib/secrets';

describe('Secrets', () => {
  it('generates unique secrets', async () => {
    const s1 = generateSecret();
    const s2 = generateSecret();
    expect(s1).not.toBe(s2);
    expect(s1).toHaveLength(64);
  });

  it('hashes and verifies correctly', async () => {
    const secret = generateSecret();
    const hash = await hashSecret(secret);
    expect(await verifySecret(secret, hash)).toBe(true);
    expect(await verifySecret('wrong-secret', hash)).toBe(false);
  });

  it('constant time equal works', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });
});
