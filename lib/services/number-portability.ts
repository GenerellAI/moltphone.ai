/**
 * Number Portability Service
 *
 * Handles MoltNumber porting between carriers. Rules depend on nation type:
 *
 *   open     — Freely portable. Owner requests port-out, 7-day grace period.
 *              Carrier can approve early or reject with valid reason.
 *              After 7 days without action → auto-approved and executed.
 *
 *   org      — No individual port-out. The org controls carrier delegation.
 *              If the org revokes a carrier's delegation, the numbers are
 *              not individually portable.
 *
 *   carrier  — Non-portable. Agent loses number on departure from the carrier.
 *
 * Self-certifying numbers mean the agent proves ownership by signing with
 * their private key. No need to contact the originating carrier for auth.
 */

import { prisma } from '@/lib/prisma';
import { PortRequestStatus, NationType } from '@prisma/client';
import { CARRIER_DOMAIN } from '@/lib/carrier-identity';
import { unbindNumber } from '@/lib/services/registry';

// ── Constants ────────────────────────────────────────────

/** Grace period in days. After this, pending port requests auto-complete. */
export const PORT_GRACE_PERIOD_DAYS = 7;

/** Maximum active (pending/approved) port requests per agent. */
export const MAX_ACTIVE_PORT_REQUESTS = 1;

// ── Portability Check ────────────────────────────────────

export interface PortabilityCheck {
  portable: boolean;
  reason?: string;
  nationType: NationType;
}

/**
 * Check whether an agent's number is portable based on nation type.
 */
export async function checkPortability(agentId: string): Promise<PortabilityCheck> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { nation: { select: { type: true, code: true } } },
  });

  if (!agent) return { portable: false, reason: 'Agent not found', nationType: 'open' as NationType };
  if (!agent.isActive) return { portable: false, reason: 'Agent is deactivated', nationType: agent.nation.type };

  switch (agent.nation.type) {
    case 'open':
      return { portable: true, nationType: 'open' };
    case 'org':
      return { portable: false, reason: 'Org nation numbers are not individually portable. The organization controls carrier delegation.', nationType: 'org' };
    case 'carrier':
      return { portable: false, reason: 'Carrier nation numbers are non-portable. The number is tied to this carrier.', nationType: 'carrier' };
    default:
      return { portable: false, reason: 'Unknown nation type', nationType: agent.nation.type };
  }
}

// ── Port-Out Request ─────────────────────────────────────

export interface RequestPortOutInput {
  agentId: string;
  toCarrierDomain?: string; // Target carrier (optional — may not know yet)
}

export interface RequestPortOutResult {
  ok: boolean;
  portRequest?: Awaited<ReturnType<typeof prisma.portRequest.create>>;
  error?: string;
}

/**
 * Request port-out for an agent. Only valid for open nations.
 * Creates a port request with a 7-day grace period.
 */
export async function requestPortOut(input: RequestPortOutInput): Promise<RequestPortOutResult> {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    include: { nation: { select: { type: true, code: true } } },
  });

  if (!agent) return { ok: false, error: 'Agent not found' };
  if (!agent.isActive) return { ok: false, error: 'Agent is deactivated' };

  // Check nation type portability
  const portability = await checkPortability(input.agentId);
  if (!portability.portable) return { ok: false, error: portability.reason };

  // Check for existing active port requests
  const existing = await prisma.portRequest.findFirst({
    where: {
      agentId: input.agentId,
      status: { in: ['pending', 'approved'] },
    },
  });
  if (existing) {
    return { ok: false, error: 'An active port request already exists for this agent' };
  }

  // Calculate grace period expiry
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + PORT_GRACE_PERIOD_DAYS);

  const portRequest = await prisma.portRequest.create({
    data: {
      agentId: input.agentId,
      moltNumber: agent.moltNumber,
      nationCode: agent.nationCode,
      fromCarrierDomain: CARRIER_DOMAIN,
      toCarrierDomain: input.toCarrierDomain ?? null,
      expiresAt,
    },
  });

  return { ok: true, portRequest };
}

// ── Carrier Actions ──────────────────────────────────────

/**
 * Carrier approves a port-out request before the grace period expires.
 */
export async function approvePortOut(portRequestId: string): Promise<{ ok: boolean; error?: string }> {
  const pr = await prisma.portRequest.findUnique({ where: { id: portRequestId } });
  if (!pr) return { ok: false, error: 'Port request not found' };
  if (pr.status !== 'pending') return { ok: false, error: `Cannot approve: status is "${pr.status}"` };

  await prisma.portRequest.update({
    where: { id: portRequestId },
    data: { status: 'approved', resolvedAt: new Date() },
  });

  return { ok: true };
}

/**
 * Carrier rejects a port-out request with a valid reason.
 */
export async function rejectPortOut(portRequestId: string, reason: string): Promise<{ ok: boolean; error?: string }> {
  const pr = await prisma.portRequest.findUnique({ where: { id: portRequestId } });
  if (!pr) return { ok: false, error: 'Port request not found' };
  if (pr.status !== 'pending') return { ok: false, error: `Cannot reject: status is "${pr.status}"` };

  await prisma.portRequest.update({
    where: { id: portRequestId },
    data: { status: 'rejected', resolvedAt: new Date(), rejectReason: reason },
  });

  return { ok: true };
}

/**
 * Agent owner cancels a pending port-out request.
 */
export async function cancelPortOut(portRequestId: string): Promise<{ ok: boolean; error?: string }> {
  const pr = await prisma.portRequest.findUnique({ where: { id: portRequestId } });
  if (!pr) return { ok: false, error: 'Port request not found' };
  if (pr.status !== 'pending') return { ok: false, error: `Cannot cancel: status is "${pr.status}"` };

  await prisma.portRequest.update({
    where: { id: portRequestId },
    data: { status: 'cancelled', resolvedAt: new Date() },
  });

  return { ok: true };
}

// ── Port Execution ───────────────────────────────────────

/**
 * Execute an approved port-out: unbind the number from the registry,
 * deactivate the agent locally, and record identity continuity.
 *
 * This is the final step — after this, the number is free to be bound
 * to a new carrier.
 */
export async function executePort(portRequestId: string): Promise<{ ok: boolean; error?: string }> {
  const pr = await prisma.portRequest.findUnique({
    where: { id: portRequestId },
    include: { agent: true },
  });
  if (!pr) return { ok: false, error: 'Port request not found' };
  if (pr.status !== 'approved') return { ok: false, error: `Cannot execute: status is "${pr.status}", expected "approved"` };

  // Deactivate the agent locally and add the MoltNumber to previousNumbers
  // for identity continuity (other agents can track this agent across carriers)
  const agent = pr.agent;
  const previousNumbers = [...(agent.previousNumbers || [])];
  // Only add if not already in the list
  if (!previousNumbers.includes(pr.moltNumber)) {
    previousNumbers.push(pr.moltNumber);
  }

  await prisma.$transaction([
    // Deactivate the agent
    prisma.agent.update({
      where: { id: pr.agentId },
      data: {
        isActive: false,
        previousNumbers,
      },
    }),
    // Mark port request as completed
    prisma.portRequest.update({
      where: { id: portRequestId },
      data: { status: 'completed', completedAt: new Date() },
    }),
  ]);

  // Unbind from registry (best-effort, non-blocking)
  unbindNumber(pr.moltNumber).catch(() => {/* non-critical */});

  return { ok: true };
}

// ── Cron: Auto-Approve Expired Requests ──────────────────

export interface ExpirePortRequestsResult {
  autoApproved: number;
  autoExecuted: number;
  errors: string[];
}

/**
 * Process expired port requests:
 * 1. Auto-approve any pending requests past their grace period
 * 2. Auto-execute any approved requests
 *
 * Run as a cron job: POST /api/admin/expire-port-requests
 */
export async function expirePortRequests(): Promise<ExpirePortRequestsResult> {
  const now = new Date();
  const result: ExpirePortRequestsResult = { autoApproved: 0, autoExecuted: 0, errors: [] };

  // Step 1: Auto-approve pending requests past their grace period
  const expiredPending = await prisma.portRequest.findMany({
    where: {
      status: 'pending',
      expiresAt: { lte: now },
    },
  });

  for (const pr of expiredPending) {
    try {
      await prisma.portRequest.update({
        where: { id: pr.id },
        data: { status: 'approved', resolvedAt: now },
      });
      result.autoApproved++;
    } catch (e) {
      result.errors.push(`Failed to auto-approve ${pr.id}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  // Step 2: Execute all approved requests (both manually and auto-approved)
  const approved = await prisma.portRequest.findMany({
    where: { status: 'approved' },
  });

  for (const pr of approved) {
    try {
      const execResult = await executePort(pr.id);
      if (execResult.ok) {
        result.autoExecuted++;
      } else {
        result.errors.push(`Failed to execute ${pr.id}: ${execResult.error}`);
      }
    } catch (e) {
      result.errors.push(`Failed to execute ${pr.id}: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return result;
}

// ── Query Helpers ────────────────────────────────────────

/**
 * Get port requests for an agent.
 */
export async function getAgentPortRequests(agentId: string) {
  return prisma.portRequest.findMany({
    where: { agentId },
    orderBy: { requestedAt: 'desc' },
  });
}

/**
 * Get a single port request by ID.
 */
export async function getPortRequest(id: string) {
  return prisma.portRequest.findUnique({
    where: { id },
    include: { agent: { select: { id: true, moltNumber: true, displayName: true, nationCode: true, ownerId: true } } },
  });
}

/**
 * List all pending port requests (admin view).
 */
export async function listPendingPortRequests() {
  return prisma.portRequest.findMany({
    where: { status: 'pending' },
    include: { agent: { select: { id: true, moltNumber: true, displayName: true, nationCode: true } } },
    orderBy: { requestedAt: 'asc' },
  });
}

/**
 * List all port requests with optional status filter (admin view).
 */
export async function listPortRequests(status?: PortRequestStatus) {
  return prisma.portRequest.findMany({
    where: status ? { status } : {},
    include: { agent: { select: { id: true, moltNumber: true, displayName: true, nationCode: true } } },
    orderBy: { requestedAt: 'desc' },
    take: 100,
  });
}
