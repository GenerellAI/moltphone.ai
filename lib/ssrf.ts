import { URL } from 'url';
import dns from 'dns/promises';

const BLOCKED_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^0\./,
];

export async function validateWebhookUrl(rawUrl: string): Promise<{ ok: boolean; reason?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, reason: 'Only http/https allowed' };
  }

  const hostname = parsed.hostname;
  
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || /^[0-9a-f:]+$/i.test(hostname)) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(hostname)) {
        return { ok: false, reason: 'Private IP range not allowed' };
      }
    }
    return { ok: true };
  }

  try {
    const addrs = await dns.resolve4(hostname).catch(() => []);
    const addrs6 = await dns.resolve6(hostname).catch(() => []);
    const all = [...addrs, ...addrs6];
    for (const addr of all) {
      for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(addr)) {
          return { ok: false, reason: 'Hostname resolves to private IP' };
        }
      }
    }
  } catch {
    // Can't resolve, allow
  }

  return { ok: true };
}
