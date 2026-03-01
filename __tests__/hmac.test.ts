import { signRequest, verifyHMACSignature, buildCanonicalString, computeBodyHash } from '../lib/hmac';

describe('HMAC Signature', () => {
  const secret = 'test-secret-key-12345';
  const params = {
    method: 'POST',
    path: '/dial/a/agent-123',
    callerAgentId: 'caller-456',
    targetAgentId: 'agent-123',
    body: JSON.stringify({ message: 'hello' }),
    secret,
  };

  it('signs and verifies correctly', async () => {
    const headers = signRequest(params);
    
    const result = await verifyHMACSignature({
      ...params,
      timestamp: headers['x-moltphone-timestamp'],
      nonce: headers['x-moltphone-nonce'],
      signature: headers['x-moltphone-signature'],
    });
    
    expect(result.valid).toBe(true);
  });

  it('rejects tampered signature', async () => {
    const headers = signRequest(params);
    const result = await verifyHMACSignature({
      ...params,
      timestamp: headers['x-moltphone-timestamp'],
      nonce: headers['x-moltphone-nonce'],
      signature: 'v1=deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Signature mismatch');
  });

  it('rejects expired timestamp', async () => {
    const oldTimestamp = (Math.floor(Date.now() / 1000) - 400).toString();
    const bodyHash = computeBodyHash(params.body);
    const canonical = buildCanonicalString({
      method: params.method,
      path: params.path,
      callerAgentId: params.callerAgentId,
      targetAgentId: params.targetAgentId,
      timestamp: oldTimestamp,
      nonce: 'test-nonce',
      bodyHash,
    });
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', secret).update(canonical).digest('hex');
    
    const result = await verifyHMACSignature({
      ...params,
      timestamp: oldTimestamp,
      nonce: 'test-nonce',
      signature: `v1=${sig}`,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Timestamp out of window');
  });

  it('rejects invalid signature format', async () => {
    const headers = signRequest(params);
    const result = await verifyHMACSignature({
      ...params,
      timestamp: headers['x-moltphone-timestamp'],
      nonce: headers['x-moltphone-nonce'],
      signature: 'invalid-format',
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('Invalid signature format');
  });
});
