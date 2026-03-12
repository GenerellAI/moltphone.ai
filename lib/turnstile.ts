/**
 * Cloudflare Turnstile server-side verification.
 *
 * Set TURNSTILE_SECRET_KEY in .env to enable.
 * When the key is absent (dev mode), verification is skipped.
 *
 * Client-side: use NEXT_PUBLIC_TURNSTILE_SITE_KEY with @marsidev/react-turnstile.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export interface TurnstileResult {
  success: boolean;
  /** Human-readable error (only when success=false) */
  error?: string;
}

/**
 * Verify a Turnstile token server-side.
 * Returns `{ success: true }` when:
 *   - The token is valid, OR
 *   - TURNSTILE_SECRET_KEY is not configured (dev bypass)
 */
export async function verifyTurnstile(token: string | null | undefined): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // If Turnstile is not configured, skip verification (dev mode)
  if (!secret) return { success: true };

  if (!token) return { success: false, error: 'Missing Turnstile token' };

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });

    const data = await res.json();
    if (data.success) return { success: true };

    const codes: string[] = data['error-codes'] || [];
    return { success: false, error: `Turnstile verification failed: ${codes.join(', ') || 'unknown'}` };
  } catch (err) {
    console.error('[turnstile] Verification request failed:', err);
    // Fail open in case of network issues — rate limiting is the backup
    return { success: true };
  }
}
