import { URL } from 'url';
import dns from 'dns/promises';
import { prisma } from './prisma';

const IS_DEV = process.env.NODE_ENV === 'development';

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
  // In development, allow any URL (localhost, private IPs, etc.)
  if (IS_DEV) {
    try { new URL(rawUrl); } catch {
      return { ok: false, reason: 'Invalid URL' };
    }
    return { ok: true };
  }

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

  // Strip IPv6 brackets for pattern matching
  const bareHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  
  if (/^\d+\.\d+\.\d+\.\d+$/.test(bareHost) || /^[0-9a-f:]+$/i.test(bareHost)) {
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(bareHost)) {
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
    return { ok: false, reason: 'DNS resolution failed' };
  }

  return { ok: true };
}

/**
 * Check that an endpoint URL isn't already registered to a different owner.
 * Same user can share a URL across their own agents. Unclaimed agents (signup)
 * are checked against all owners — the URL must be globally unused.
 *
 * @param endpointUrl  The URL being registered
 * @param ownerId      The user attempting to register it (null for self-signup)
 * @param excludeAgentId  Exclude this agent from the check (for updates)
 */
export async function checkEndpointOwnership(
  endpointUrl: string,
  ownerId: string | null,
  excludeAgentId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Normalise: strip trailing slash for consistent matching
  const normalised = endpointUrl.replace(/\/+$/, '');

  const existing = await prisma.agent.findFirst({
    where: {
      endpointUrl: normalised,
      isActive: true,
      ...(excludeAgentId ? { id: { not: excludeAgentId } } : {}),
      // Must belong to a *different* owner (or any owner if caller is unclaimed)
      ...(ownerId
        ? { ownerId: { not: ownerId } }
        : { ownerId: { not: null } }),  // unclaimed: any owned agent blocks it
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ok: false,
      reason: 'This endpoint URL is already registered to another account.',
    };
  }

  return { ok: true };
}
