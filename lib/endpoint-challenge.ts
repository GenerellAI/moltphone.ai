/**
 * Endpoint echo challenge — verify ownership of a webhook URL.
 *
 * Before a URL is accepted as an agent's endpointUrl, the carrier sends a
 * JSON-RPC 2.0 challenge to the URL. The server must echo the challenge token
 * back in the response. This proves the registrant controls the endpoint.
 *
 * Format follows A2A conventions so conformant agents handle it naturally.
 */
import crypto from 'crypto';

const IS_DEV = process.env.NODE_ENV === 'development';
const CHALLENGE_TIMEOUT_MS = 5_000;

export interface ChallengeResult {
  ok: boolean;
  reason?: string;
}

/**
 * Send an echo challenge to an endpoint URL and verify the response.
 *
 * Skipped in development mode (where endpoints are typically localhost).
 */
export async function challengeEndpoint(endpointUrl: string): Promise<ChallengeResult> {
  if (IS_DEV) return { ok: true };

  const challenge = crypto.randomBytes(32).toString('base64url');
  const requestId = `verify-${crypto.randomUUID()}`;

  const body = JSON.stringify({
    jsonrpc: '2.0',
    method: 'molt/verify',
    params: { challenge },
    id: requestId,
  });

  let res: Response;
  try {
    res = await fetch(endpointUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CHALLENGE_TIMEOUT_MS),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown error';
    return { ok: false, reason: `Endpoint unreachable: ${message}` };
  }

  if (!res.ok) {
    return { ok: false, reason: `Endpoint returned HTTP ${res.status}` };
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return { ok: false, reason: 'Endpoint did not return valid JSON' };
  }

  // Validate JSON-RPC envelope
  if (
    typeof json !== 'object' ||
    json === null ||
    !('result' in json)
  ) {
    return { ok: false, reason: 'Endpoint response missing "result" field' };
  }

  const result = (json as { result: unknown }).result;
  if (
    typeof result !== 'object' ||
    result === null ||
    !('challenge' in result)
  ) {
    return { ok: false, reason: 'Endpoint response missing "result.challenge"' };
  }

  const echoed = (result as { challenge: unknown }).challenge;
  if (echoed !== challenge) {
    return { ok: false, reason: 'Challenge token mismatch — endpoint did not echo correctly' };
  }

  return { ok: true };
}
