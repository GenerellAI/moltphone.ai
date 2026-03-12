/**
 * Call Policy types.
 *
 * Inbound and outbound policy configs stored as JSON on Agent and User models.
 * Agent-level policies override the user's global policy. If an agent has no
 * policy set (null), it inherits the global. Each field defaults to the most
 * permissive value when absent.
 */

// ── Inbound Policy ───────────────────────────────────────

export interface CallPolicyIn {
  /** Nation codes to accept calls from. Empty = all nations. */
  allowedNations: string[];

  /** Nation codes to block. Evaluated after allowedNations. */
  blockedNations: string[];

  /** Require caller to have at least one of these verifications (x, github, domain). Empty = no requirement. */
  requiredVerifications: VerificationProvider[];

  /** Allow anonymous callers (attestation C, no MoltNumber). Default true. */
  allowAnonymous: boolean;

  /** Only accept calls from contacts. Default false. */
  contactsOnly: boolean;

  /** Specific MoltNumbers or agent IDs to always allow (bypass other filters). */
  allowlist: string[];

  /** Specific MoltNumbers or agent IDs to always block. */
  blocklist: string[];

  /** Minimum caller agent age in days. 0 = no minimum. */
  minAgentAgeDays: number;

  /** Max inbound calls per hour from the same caller. 0 = unlimited. */
  maxCallsPerHourPerCaller: number;
}

// ── Outbound Policy ──────────────────────────────────────

export interface CallPolicyOut {
  /** Nation codes the agent can call. Empty = all nations. */
  allowedNations: string[];

  /** Only call agents in the owner's contacts. Default false. */
  contactsOnly: boolean;

  /** Only call agents that have social verification. Default false. */
  verifiedOnly: boolean;

  /** Require owner confirmation before agent initiates outbound calls. Default false. */
  requireConfirmation: boolean;
}

// ── Helpers ──────────────────────────────────────────────

export type VerificationProvider = 'x' | 'github' | 'domain';

export const DEFAULT_POLICY_IN: CallPolicyIn = {
  allowedNations: [],
  blockedNations: [],
  requiredVerifications: [],
  allowAnonymous: true,
  contactsOnly: false,
  allowlist: [],
  blocklist: [],
  minAgentAgeDays: 0,
  maxCallsPerHourPerCaller: 0,
};

export const DEFAULT_POLICY_OUT: CallPolicyOut = {
  allowedNations: [],
  contactsOnly: false,
  verifiedOnly: false,
  requireConfirmation: false,
};

/**
 * Merge an agent's policy with the global policy.
 * Agent-level policy wins if set (non-null), otherwise global, otherwise default.
 */
export function resolvePolicy<T extends CallPolicyIn | CallPolicyOut>(
  agentPolicy: T | null | undefined,
  globalPolicy: T | null | undefined,
  defaultPolicy: T,
): T {
  if (agentPolicy) return agentPolicy;
  if (globalPolicy) return globalPolicy;
  return defaultPolicy;
}

/**
 * Parse and validate a JSON policy from the database.
 * Returns the parsed policy or null if invalid/missing.
 */
export function parsePolicyIn(json: unknown): CallPolicyIn | null {
  if (!json || typeof json !== 'object') return null;
  const p = json as Record<string, unknown>;
  return {
    allowedNations: Array.isArray(p.allowedNations) ? p.allowedNations.filter(n => typeof n === 'string') : [],
    blockedNations: Array.isArray(p.blockedNations) ? p.blockedNations.filter(n => typeof n === 'string') : [],
    requiredVerifications: Array.isArray(p.requiredVerifications) ? p.requiredVerifications.filter(v => ['x', 'github', 'domain'].includes(v as string)) as VerificationProvider[] : [],
    allowAnonymous: typeof p.allowAnonymous === 'boolean' ? p.allowAnonymous : true,
    contactsOnly: typeof p.contactsOnly === 'boolean' ? p.contactsOnly : false,
    allowlist: Array.isArray(p.allowlist) ? p.allowlist.filter(n => typeof n === 'string') : [],
    blocklist: Array.isArray(p.blocklist) ? p.blocklist.filter(n => typeof n === 'string') : [],
    minAgentAgeDays: typeof p.minAgentAgeDays === 'number' ? Math.max(0, Math.floor(p.minAgentAgeDays)) : 0,
    maxCallsPerHourPerCaller: typeof p.maxCallsPerHourPerCaller === 'number' ? Math.max(0, Math.floor(p.maxCallsPerHourPerCaller)) : 0,
  };
}

export function parsePolicyOut(json: unknown): CallPolicyOut | null {
  if (!json || typeof json !== 'object') return null;
  const p = json as Record<string, unknown>;
  return {
    allowedNations: Array.isArray(p.allowedNations) ? p.allowedNations.filter(n => typeof n === 'string') : [],
    contactsOnly: typeof p.contactsOnly === 'boolean' ? p.contactsOnly : false,
    verifiedOnly: typeof p.verifiedOnly === 'boolean' ? p.verifiedOnly : false,
    requireConfirmation: typeof p.requireConfirmation === 'boolean' ? p.requireConfirmation : false,
  };
}
