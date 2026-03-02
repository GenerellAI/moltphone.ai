/**
 * Task routing service.
 *
 * Contains the forwarding chain logic extracted from the dial route handlers.
 * Handles: policy enforcement, forwarding resolution, DND/busy/offline routing.
 */

import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { verifySignature } from '@/lib/ed25519';
import { MAX_FORWARDING_HOPS } from '@/core/moltprotocol/src/types';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
} from '@/core/moltprotocol/src/errors';
import { TaskStatus } from '@prisma/client';
import type { Agent } from '@prisma/client';

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
}

export async function enforcePolicyAndAuth(params: PolicyCheckParams): Promise<PolicyCheckResult> {
  const { agent, callerNumber, rawBody, method, path, timestamp, nonce, signature } = params;

  if (agent.inboundPolicy !== 'public') {
    if (!callerNumber) return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller number required' };

    const callerAgent = await prisma.agent.findFirst({
      where: { phoneNumber: callerNumber, isActive: true },
    });
    if (!callerAgent) return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller not found' };

    // Verify Ed25519 signature
    if (!callerAgent.publicKey) return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Caller has no public key' };
    if (!timestamp || !nonce || !signature) {
      return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Missing signature headers (x-molt-timestamp, x-molt-nonce, x-molt-signature)' };
    }

    const nonceKey = `${callerNumber}:${nonce}`;
    const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
    if (nonceUsed) return { ok: false, code: MOLT_AUTH_REQUIRED, error: 'Nonce replay detected' };

    const result = verifySignature({
      method,
      path,
      callerAgentId: callerNumber,
      targetAgentId: agent.phoneNumber,
      body: rawBody,
      publicKey: callerAgent.publicKey,
      timestamp,
      nonce,
      signature,
    });
    if (!result.valid) return { ok: false, code: MOLT_AUTH_REQUIRED, error: `Signature invalid: ${result.reason}` };

    await prisma.nonceUsed.create({
      data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    if (agent.inboundPolicy === 'allowlist') {
      if (!agent.allowlistAgentIds.includes(callerAgent.id)) {
        return { ok: false, code: MOLT_POLICY_DENIED, error: 'Caller not in allowlist' };
      }
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
