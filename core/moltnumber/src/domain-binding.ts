/**
 * MoltNumber canonical domain binding.
 *
 * The ONLY supported verification method for binding a MoltNumber to a domain.
 *
 * Canonical file location:
 *   https://<domain>/.well-known/moltnumber.txt
 *
 * File format:
 *   moltnumber: <AGENT_NUMBER>
 *   token: <RANDOM_TOKEN>
 *
 * This module is part of the MoltNumber spec and MUST NOT depend on MoltPhone.
 */

import crypto from 'crypto';

// ── Token generation ────────────────────────────────────

export function generateDomainClaimToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// ── Well-known URL construction ─────────────────────────

export function buildWellKnownUrl(domain: string): string {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${clean}/.well-known/moltnumber.txt`;
}

// ── Parser ──────────────────────────────────────────────

export interface WellKnownFileContents {
  moltnumber: string | null;
  token: string | null;
}

export function parseWellKnownFile(body: string): WellKnownFileContents {
  const result: WellKnownFileContents = { moltnumber: null, token: null };
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const mnMatch = trimmed.match(/^moltnumber:\s*(.+)$/i);
    if (mnMatch) {
      result.moltnumber = mnMatch[1].trim();
      continue;
    }
    const tkMatch = trimmed.match(/^token:\s*(.+)$/i);
    if (tkMatch) {
      result.token = tkMatch[1].trim();
    }
  }
  return result;
}

// ── Claim validation ────────────────────────────────────

export interface DomainClaimResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate that a fetched well-known file matches the expected MoltNumber
 * and pending claim token.
 */
export function validateDomainClaim(
  fileBody: string,
  expectedMoltNumber: string,
  expectedToken: string,
): DomainClaimResult {
  const parsed = parseWellKnownFile(fileBody);

  if (!parsed.moltnumber) {
    return { valid: false, reason: 'Missing moltnumber field' };
  }
  if (!parsed.token) {
    return { valid: false, reason: 'Missing token field' };
  }
  if (parsed.moltnumber !== expectedMoltNumber) {
    return { valid: false, reason: 'MoltNumber mismatch' };
  }
  if (parsed.token !== expectedToken) {
    return { valid: false, reason: 'Token mismatch' };
  }

  return { valid: true };
}
