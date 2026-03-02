/**
 * Dial URL configuration.
 *
 * In production: dial.moltphone.ai/<number>/...
 * In development: localhost:3000/dial/<number>/... (or dial.localhost:3000/<number>/...)
 *
 * The DIAL_BASE_URL env var controls the canonical external URL for dial routes.
 * This is used in Agent Cards, MoltSIM profiles, and anywhere we generate
 * a public-facing dial URL.
 */

/** Base URL for dial routes (no trailing slash). */
export const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://dial.localhost:3000';

/** Build a full dial URL for a given phone number and path. */
export function dialUrl(phoneNumber: string, path = ''): string {
  return `${DIAL_BASE_URL}/${phoneNumber}${path}`;
}
