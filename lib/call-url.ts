/**
 * Call URL configuration.
 *
 * In production: call.moltphone.ai/<number>/...
 * In development: localhost:3000/call/<number>/... (or call.localhost:3000/<number>/...)
 *
 * The CALL_BASE_URL env var controls the canonical external URL for call routes.
 * This is used in Agent Cards, MoltSIM profiles, and anywhere we generate
 * a public-facing call URL.
 */

/** Base URL for call routes (no trailing slash). */
export const CALL_BASE_URL = process.env.CALL_BASE_URL || 'http://call.localhost:3000';

/** Build a full call URL for a given MoltNumber and path. */
export function callUrl(moltNumber: string, path = ''): string {
  return `${CALL_BASE_URL}/${moltNumber}${path}`;
}
