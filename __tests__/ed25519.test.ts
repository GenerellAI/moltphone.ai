import {
  generateKeyPair,
  buildCanonicalString,
  computeBodyHash,
  signRequest,
  verifySignature,
} from '../core/moltprotocol/src/ed25519';

describe('MoltProtocol Ed25519', () => {
  it('generates a keypair with base64url-encoded keys', () => {
    const kp = generateKeyPair();
    expect(typeof kp.publicKey).toBe('string');
    expect(typeof kp.privateKey).toBe('string');
    // base64url — no +, /, or = padding
    expect(kp.publicKey).not.toMatch(/[+/=]/);
    expect(kp.privateKey).not.toMatch(/[+/=]/);
  });

  it('generates unique keypairs each call', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });

  it('buildCanonicalString joins fields with newlines', () => {
    const s = buildCanonicalString({
      method: 'POST',
      path: '/dial/MOLT-0001/tasks/send',
      callerAgentId: 'AION-0001',
      targetAgentId: 'MOLT-0001',
      timestamp: '1700000000',
      nonce: 'abc123',
      bodyHash: 'deadbeef',
    });
    expect(s).toBe('POST\n/dial/MOLT-0001/tasks/send\nAION-0001\nMOLT-0001\n1700000000\nabc123\ndeadbeef');
  });

  it('uppercases the method in canonical string', () => {
    const s = buildCanonicalString({
      method: 'post',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      timestamp: '0',
      nonce: 'n',
      bodyHash: 'h',
    });
    expect(s.startsWith('POST\n')).toBe(true);
  });

  it('computeBodyHash returns a hex SHA-256', () => {
    const h = computeBodyHash('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sign + verify round-trip succeeds', () => {
    const kp = generateKeyPair();
    const body = JSON.stringify({ message: { parts: [{ type: 'text', text: 'Hello' }] } });

    const headers = signRequest({
      method: 'POST',
      path: '/dial/MOLT-0001/tasks/send',
      callerAgentId: 'AION-0001',
      targetAgentId: 'MOLT-0001',
      body,
      privateKey: kp.privateKey,
    });

    const result = verifySignature({
      method: 'POST',
      path: '/dial/MOLT-0001/tasks/send',
      callerAgentId: 'AION-0001',
      targetAgentId: 'MOLT-0001',
      body,
      publicKey: kp.publicKey,
      timestamp: headers['x-molt-timestamp'],
      nonce: headers['x-molt-nonce'],
      signature: headers['x-molt-signature'],
    });

    expect(result.valid).toBe(true);
  });

  it('verification fails with wrong public key', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const body = '{"test":true}';

    const headers = signRequest({
      method: 'POST',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      body,
      privateKey: kp1.privateKey,
    });

    const result = verifySignature({
      method: 'POST',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      body,
      publicKey: kp2.publicKey,
      timestamp: headers['x-molt-timestamp'],
      nonce: headers['x-molt-nonce'],
      signature: headers['x-molt-signature'],
    });

    expect(result.valid).toBe(false);
  });

  it('verification fails when body is tampered', () => {
    const kp = generateKeyPair();
    const body = '{"original":true}';

    const headers = signRequest({
      method: 'POST',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      body,
      privateKey: kp.privateKey,
    });

    const result = verifySignature({
      method: 'POST',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      body: '{"tampered":true}',
      publicKey: kp.publicKey,
      timestamp: headers['x-molt-timestamp'],
      nonce: headers['x-molt-nonce'],
      signature: headers['x-molt-signature'],
    });

    expect(result.valid).toBe(false);
  });

  it('verification fails when timestamp is out of window', () => {
    const kp = generateKeyPair();
    const body = 'test';

    const result = verifySignature({
      method: 'POST',
      path: '/test',
      callerAgentId: 'A',
      targetAgentId: 'B',
      body,
      publicKey: kp.publicKey,
      timestamp: '1000', // way in the past
      nonce: 'anonce',
      signature: 'invalidsig',
      windowSeconds: 300,
    });

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Timestamp out of window');
  });
});
