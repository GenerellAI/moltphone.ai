/**
 * API Key authentication helper.
 *
 * Keys are formatted as: molt_k1_<64-hex-chars>
 * The prefix "molt_k1_" is stored in plaintext for lookup;
 * the full key is bcrypt-hashed for verification.
 */
import { prisma } from './prisma';
import { generateSecret, verifySecret } from './secrets';
import bcrypt from 'bcryptjs';

export const API_KEY_PREFIX = 'molt_k1_';

/** Result from authenticating an API key */
export interface ApiKeyUser {
  id: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
}

/**
 * Generate a new raw API key string.
 * Format: molt_k1_<64 hex chars>
 */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${generateSecret(32)}`;
}

/**
 * Extract the prefix (first 12 chars including "molt_k1_") from a raw key.
 * Used to narrow the DB lookup before bcrypt comparison.
 */
export function extractPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

/**
 * Hash a raw API key for storage.
 */
export async function hashApiKey(rawKey: string): Promise<string> {
  return bcrypt.hash(rawKey, 10);
}

/**
 * Authenticate a request by API key.
 * Looks for `Authorization: Bearer molt_k1_...` header.
 *
 * Returns the owning user if valid, or null.
 */
export async function authenticateApiKey(
  authHeader: string | null,
): Promise<ApiKeyUser | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const rawKey = authHeader.slice(7).trim();
  if (!rawKey.startsWith(API_KEY_PREFIX)) return null;

  const prefix = extractPrefix(rawKey);

  // Find all non-revoked keys with this prefix (typically 1)
  const candidates = await prisma.apiKey.findMany({
    where: {
      prefix,
      revokedAt: null,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          role: true,
          emailVerifiedAt: true,
        },
      },
    },
  });

  for (const candidate of candidates) {
    // Check expiry
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;

    const match = await verifySecret(rawKey, candidate.keyHash);
    if (match) {
      // Update lastUsedAt (fire-and-forget)
      prisma.apiKey.update({
        where: { id: candidate.id },
        data: { lastUsedAt: new Date() },
      }).catch(() => {}); // best-effort

      return candidate.user as ApiKeyUser;
    }
  }

  return null;
}
