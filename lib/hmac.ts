import crypto from 'crypto';
import { constantTimeEqual } from './secrets';

export interface HMACSignatureHeaders {
  'x-moltphone-caller': string;
  'x-moltphone-timestamp': string;
  'x-moltphone-nonce': string;
  'x-moltphone-signature': string;
}

export function buildCanonicalString(params: {
  method: string;
  path: string;
  callerAgentId: string;
  targetAgentId: string;
  timestamp: string;
  nonce: string;
  bodyHash: string;
}): string {
  return [
    params.method.toUpperCase(),
    params.path,
    params.callerAgentId,
    params.targetAgentId,
    params.timestamp,
    params.nonce,
    params.bodyHash,
  ].join('\n');
}

export function computeBodyHash(body: string): string {
  return crypto.createHash('sha256').update(body).digest('hex');
}

export function signRequest(params: {
  method: string;
  path: string;
  callerAgentId: string;
  targetAgentId: string;
  body: string;
  secret: string;
}): HMACSignatureHeaders {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = computeBodyHash(params.body);
  const canonical = buildCanonicalString({
    method: params.method,
    path: params.path,
    callerAgentId: params.callerAgentId,
    targetAgentId: params.targetAgentId,
    timestamp,
    nonce,
    bodyHash,
  });
  const sig = crypto.createHmac('sha256', params.secret).update(canonical).digest('hex');
  return {
    'x-moltphone-caller': params.callerAgentId,
    'x-moltphone-timestamp': timestamp,
    'x-moltphone-nonce': nonce,
    'x-moltphone-signature': `v1=${sig}`,
  };
}

export async function verifyHMACSignature(params: {
  method: string;
  path: string;
  callerAgentId: string;
  targetAgentId: string;
  body: string;
  secret: string;
  timestamp: string;
  nonce: string;
  signature: string;
}): Promise<{ valid: boolean; reason?: string }> {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(params.timestamp, 10);
  if (isNaN(ts) || Math.abs(now - ts) > 300) {
    return { valid: false, reason: 'Timestamp out of window' };
  }

  const sigMatch = params.signature.match(/^v1=([0-9a-f]+)$/);
  if (!sigMatch) return { valid: false, reason: 'Invalid signature format' };

  const bodyHash = computeBodyHash(params.body);
  const canonical = buildCanonicalString({
    method: params.method,
    path: params.path,
    callerAgentId: params.callerAgentId,
    targetAgentId: params.targetAgentId,
    timestamp: params.timestamp,
    nonce: params.nonce,
    bodyHash,
  });
  const expected = crypto.createHmac('sha256', params.secret).update(canonical).digest('hex');

  if (!constantTimeEqual(sigMatch[1], expected)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}
