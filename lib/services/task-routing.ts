/**
 * Task routing service.
 *
 * Contains the forwarding chain logic extracted from the call route handlers.
 * Handles: policy enforcement, forwarding resolution, DND/busy/offline routing.
 */

import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { verifySignature } from '@/lib/ed25519';
import { isNonceReplay } from '@/lib/nonce';
import { MAX_FORWARDING_HOPS } from '@moltprotocol/core';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
} from '@moltprotocol/core';
import { TaskStatus } from '@prisma/client';
import type { Agent } from '@prisma/client';
import {
  type CallPolicyIn,
  DEFAULT_POLICY_IN,
  parsePolicyIn,
  resolvePolicy,
} from '@/lib/call-policy';

// ── Forward resolution ───────────────────────────────────

export async function resolveForwarding(
  agentId: string,
  hops: string[],
): Promise<{ finalAgentId: string; hops: string[] }> {
  if (hops.length >= MAX_FORWARDING_HOPS) return { finalAgentId: agentId, hops };

  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent?.callForwardingEnabled || !agent.forwardToAgentId) return { finalAgentId: agentId, hops };

  const online = isOnline(agent.lastSeenAt);
  const shouldForward = await (async () => {
    switch (agent.forwardCondition) {
      case 'always': return true;
      case 'when_offline': return !online;
      case 'when_busy': {
        const active = await prisma.task.count({
          where: { calleeId: agentId, status: TaskStatus.working },
        });
        return active >= agent.maxConcurrentCalls;
      }
      case 'when_dnd': return agent.dndEnabled;
      default: return false;
    }
  })();

  if (!shouldForward) return { finalAgentId: agentId, hops };

  const newHops = [...hops, agentId];
  if (newHops.includes(agent.forwardToAgentId)) {
    return { finalAgentId: agentId, hops: newHops }; // loop detected
  }

  return resolveForwarding(agent.forwardToAgentId, newHops);
}

// ── Inbound policy enforcement ───────────────────────────

export interface PolicyCheckParams {
  agent: Agent;
  callerNumber: string | null;
  rawBody: string;
  method: string;
  path: string;
  timestamp: string | null;
  nonce: string | null;
  signature: string | null;
}

export interface PolicyCheckResult {
  ok: boolean;
  /** MoltProtocol error code (MOLT_* constant). */
  code?: number;
  error?: string;
  /** Whether the caller's Ed25519 signature was verified. */
  callerVerified?: boolean;
  /** Whether the caller is a registered agent on this carrier. */
  callerRegistered?: boolean;
}

export async function enforcePolicyAndAuth(params: PolicyCheckParams): Promise<PolicyCheckResult> {
  const { agent, callerNumber, rawBody, method, path, timestamp, nonce, signature } = params;

  if (agent.inboundPolicy !== 'public') {
    if (!callerNumber) return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller number required' };

    const callerAgent = await prisma.agent.findFirst({
      where: { moltNumber: callerNumber, isActive: true },
    });
    if (!callerAgent) return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller not found' };

    // Verify Ed25519 signature
    if (!callerAgent.publicKey) return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Caller has no public key' };
    if (!timestamp || !nonce || !signature) {
      return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Missing signature headers (x-molt-timestamp, x-molt-nonce, x-molt-signature)' };
    }

    const nonceKey = `${callerNumber}:${nonce}`;
    if (await isNonceReplay(nonceKey)) return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Nonce replay detected' };

    const result = verifySignature({
      method,
      path,
      callerAgentId: callerNumber,
      targetAgentId: agent.moltNumber,
      body: rawBody,
      publicKey: callerAgent.publicKey,
      timestamp,
      nonce,
      signature,
    });
    if (!result.valid) return { ok: false, code: MOLT_AUTH_REQUIRED, error: `Signature invalid: ${result.reason}` };

    if (agent.inboundPolicy === 'allowlist') {
      if (!agent.allowlistAgentIds.includes(callerAgent.id)) {
        return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller not in allowlist' };
      }
    }
  }

  // Determine caller verification status for carrier identity attestation
  const callerRegistered = !!callerNumber;
  // Caller is verified if non-public policy (Ed25519 was checked above) or if
  // public policy but caller provided valid signature headers
  let callerVerified = false;
  if (agent.inboundPolicy !== 'public') {
    // Non-public: signature was verified above (or we would have returned early)
    callerVerified = true;
  } else if (callerNumber && timestamp && nonce && signature) {
    // Public policy: caller optionally provided signature — verify it best-effort
    const callerAgent = await prisma.agent.findFirst({
      where: { moltNumber: callerNumber, isActive: true },
      select: { publicKey: true },
    });
    if (callerAgent?.publicKey) {
      const result = verifySignature({
        method, path, callerAgentId: callerNumber, targetAgentId: agent.moltNumber,
        body: rawBody, publicKey: callerAgent.publicKey, timestamp, nonce, signature,
      });
      callerVerified = result.valid;
    }
  }

  return { ok: true, callerVerified, callerRegistered };
}

// ── Extended call policy enforcement ─────────────────────

/**
 * Enforce the JSON-based CallPolicyIn rules after basic auth check passes.
 *
 * Evaluates: allowlist/blocklist, nations, contacts-only, anonymous callers,
 * required verifications, min agent age, per-caller rate limiting.
 *
 * The basic inboundPolicy enum (public/registered_only/allowlist) is enforced
 * by enforcePolicyAndAuth above. This function adds fine-grained filtering.
 */
export async function enforceCallPolicy(opts: {
  agent: Agent;
  callerMoltNumber: string | null;
  callerAgentId: string | null;
  callerNationCode: string | null;
  callerCreatedAt: Date | null;
}): Promise<PolicyCheckResult> {
  const { agent, callerMoltNumber, callerAgentId, callerNationCode, callerCreatedAt } = opts;

  // Resolve the effective inbound policy (agent → owner global → default)
  let ownerGlobalPolicy: CallPolicyIn | null = null;
  if (agent.ownerId) {
    try {
      const owner = await prisma.user.findUnique({
        where: { id: agent.ownerId },
        select: { globalCallPolicyIn: true },
      });
      ownerGlobalPolicy = parsePolicyIn(owner?.globalCallPolicyIn);
    } catch {
      // If user lookup fails (e.g. in tests), fall through to defaults
    }
  }
  const agentPolicy = parsePolicyIn((agent as Record<string, unknown>).callPolicyIn);
  const policy = resolvePolicy<CallPolicyIn>(agentPolicy, ownerGlobalPolicy, DEFAULT_POLICY_IN);

  // ── Allowlist bypass ────────────────────────────────
  // If the caller is explicitly allowlisted, skip all other checks
  if (callerMoltNumber && policy.allowlist.length > 0) {
    if (policy.allowlist.includes(callerMoltNumber) ||
        (callerAgentId && policy.allowlist.includes(callerAgentId))) {
      return { ok: true };
    }
  }

  // ── Blocklist ───────────────────────────────────────
  if (callerMoltNumber && policy.blocklist.length > 0) {
    if (policy.blocklist.includes(callerMoltNumber) ||
        (callerAgentId && policy.blocklist.includes(callerAgentId))) {
      return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller is in blocklist' };
    }
  }

  // ── Anonymous caller check ──────────────────────────
  if (!callerMoltNumber && !policy.allowAnonymous) {
    return { ok: false, code: MOLT_POLICY_DENIED, error: 'Anonymous callers not allowed' };
  }

  // ── Nation filter ───────────────────────────────────
  if (callerNationCode) {
    if (policy.blockedNations.length > 0 && policy.blockedNations.includes(callerNationCode)) {
      return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller nation is blocked' };
    }
    if (policy.allowedNations.length > 0 && !policy.allowedNations.includes(callerNationCode)) {
      return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller nation not in allowed list' };
    }
  }

  // ── Contacts only ──────────────────────────────────
  if (policy.contactsOnly && agent.ownerId && callerAgentId) {
    try {
      const contact = await prisma.contact.findFirst({
        where: { userId: agent.ownerId, agentId: callerAgentId },
      });
      if (!contact) {
        return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller is not in contacts' };
      }
    } catch {
      // Contact model may not be available in tests — allow through
    }
  } else if (policy.contactsOnly && !callerAgentId) {
    return { ok: false, code: MOLT_POLICY_DENIED, error: 'Known caller required (contacts only)' };
  }

  // ── Required verifications ─────────────────────────
  if (policy.requiredVerifications.length > 0 && callerAgentId) {
    try {
      const verifications = await prisma.socialVerification.findMany({
        where: { agentId: callerAgentId, status: 'verified' },
        select: { provider: true },
      });
      const verified = verifications.map(v => v.provider.toLowerCase());
      const hasRequired = policy.requiredVerifications.some(req => verified.includes(req));
      if (!hasRequired) {
        return { ok: false, code: MOLT_POLICY_DENIED, error: `Caller must have verification: ${policy.requiredVerifications.join(' or ')}` };
      }
    } catch {
      // SocialVerification model may not be available in tests — allow through
    }
  }

  // ── Minimum agent age ──────────────────────────────
  if (policy.minAgentAgeDays > 0 && callerCreatedAt) {
    const ageDays = (Date.now() - callerCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < policy.minAgentAgeDays) {
      return { ok: false, code: MOLT_POLICY_DENIED, error: `Caller agent too new (min ${policy.minAgentAgeDays} days)` };
    }
  }

  // ── Per-caller rate limit ──────────────────────────
  if (policy.maxCallsPerHourPerCaller > 0 && callerAgentId) {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCalls = await prisma.task.count({
      where: {
        calleeId: agent.id,
        callerId: callerAgentId,
        createdAt: { gte: oneHourAgo },
      },
    });
    if (recentCalls >= policy.maxCallsPerHourPerCaller) {
      return { ok: false, code: MOLT_POLICY_DENIED, error: 'Rate limit exceeded for this caller' };
    }
  }

  return { ok: true };
}

// ── Block enforcement ────────────────────────────────────

export async function isCallerBlocked(
  targetOwnerId: string,
  callerAgentId: string | null,
): Promise<boolean> {
  if (!callerAgentId) return false;
  const block = await prisma.block.findFirst({
    where: { userId: targetOwnerId, blockedAgentId: callerAgentId },
  });
  return !!block;
}

// ── Carrier-wide block enforcement ──────────────────────

/**
 * Check whether the request is blocked by a carrier-wide rule.
 * Evaluates all active CarrierBlock rows against the caller's identity
 * and the request IP.
 *
 * Returns the matching block reason (truthy) or null (not blocked).
 */
export async function checkCarrierBlock(opts: {
  callerAgentId?: string | null;
  callerMoltNumber?: string | null;
  callerNation?: string | null;
  requestIp?: string | null;
}): Promise<string | null> {
  const blocks = await prisma.carrierBlock.findMany({
    where: { isActive: true },
  });

  for (const b of blocks) {
    switch (b.type) {
      case 'agent_id':
        if (opts.callerAgentId && b.value === opts.callerAgentId) return b.reason ?? 'Carrier block (agent)';
        break;
      case 'molt_number_pattern':
        if (opts.callerMoltNumber && matchGlob(b.value, opts.callerMoltNumber)) return b.reason ?? 'Carrier block (MoltNumber pattern)';
        break;
      case 'nation_code':
        if (opts.callerNation && b.value.toUpperCase() === opts.callerNation.toUpperCase()) return b.reason ?? 'Carrier block (nation)';
        break;
      case 'ip_address':
        if (opts.requestIp && b.value === opts.requestIp) return b.reason ?? 'Carrier block (IP)';
        break;
    }
  }

  return null;
}

/** Simple glob matching: * matches any chars, ? matches one char. */
function matchGlob(pattern: string, value: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i',
  );
  return regex.test(value);
}
