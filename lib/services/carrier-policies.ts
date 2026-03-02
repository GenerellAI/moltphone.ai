/**
 * Carrier-wide allow-policy enforcement.
 *
 * These are trust requirements that ALL callers must meet before their tasks
 * are accepted. Checked AFTER carrier blocks, BEFORE per-agent inbound policy.
 *
 * Policy types:
 *   require_verified_domain   — Caller agent must have ≥1 verified domain claim
 *   require_social_verification — Caller agent must have ≥1 verified social identity
 *   minimum_age_hours         — Caller agent must be older than N hours
 */

import { prisma } from '@/lib/prisma';

export interface PolicyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Check all active carrier-wide allow policies against a caller agent.
 * Returns { ok: true } if all policies pass, or { ok: false, reason } on first failure.
 *
 * If callerAgentId is null (anonymous caller), policies requiring agent identity
 * will fail.
 */
export async function checkCarrierPolicies(callerAgentId: string | null): Promise<PolicyResult> {
  const policies = await prisma.carrierPolicy.findMany({
    where: { isActive: true },
  });

  if (policies.length === 0) return { ok: true };

  // If there are active policies but no caller identity, reject
  if (!callerAgentId) {
    return { ok: false, reason: 'Carrier policy requires identified caller' };
  }

  for (const policy of policies) {
    switch (policy.type) {
      case 'require_verified_domain': {
        const count = await prisma.domainClaim.count({
          where: { agentId: callerAgentId, status: 'verified' },
        });
        if (count === 0) {
          return { ok: false, reason: policy.reason ?? 'Caller must have a verified domain' };
        }
        break;
      }

      case 'require_social_verification': {
        const count = await prisma.socialVerification.count({
          where: { agentId: callerAgentId, status: 'verified' },
        });
        if (count === 0) {
          return { ok: false, reason: policy.reason ?? 'Caller must have a verified social identity' };
        }
        break;
      }

      case 'minimum_age_hours': {
        const hours = parseInt(policy.value || '0', 10);
        if (hours > 0) {
          const agent = await prisma.agent.findUnique({
            where: { id: callerAgentId },
            select: { createdAt: true },
          });
          if (agent) {
            const ageMs = Date.now() - agent.createdAt.getTime();
            const ageHours = ageMs / (1000 * 60 * 60);
            if (ageHours < hours) {
              return {
                ok: false,
                reason: policy.reason ?? `Caller agent must be at least ${hours} hours old`,
              };
            }
          }
        }
        break;
      }
    }
  }

  return { ok: true };
}
