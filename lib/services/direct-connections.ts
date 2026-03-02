/**
 * Direct Connection Service — privacy proxy upgrade handshake.
 *
 * Architecture grounded in three real standards:
 *
 * 1. **SIP B2BUA (RFC 7092)** — Carrier acts as a Back-to-Back User Agent.
 *    All signaling terminates at the carrier and is re-originated to the
 *    target. Agent endpoints are never exposed. This is the default mode
 *    and the baseline privacy guarantee.
 *
 * 2. **TURN relay (RFC 8656)** — `carrier_only` mode is a persistent TURN
 *    Allocation. The carrier relays ALL traffic. The agent's dial URL is
 *    the relay transport address. Permissions = inbound policy. The agent
 *    pays for relay usage (credits per message, size-based).
 *
 * 3. **ICE offer/answer (RFC 8445)** — The upgrade handshake follows ICE's
 *    candidate exchange pattern:
 *      - Propose = ICE Offer (controlling agent sends candidates)
 *      - Accept  = ICE Answer (controlled agent sends candidates)
 *      - Carrier = Signaling channel (like STUN/TURN server intermediary)
 *      - Activate = ICE connectivity check succeeded, direct link live
 *
 *    After the exchange, agents connect peer-to-peer. The carrier is out
 *    of the loop — like ICE completing and the TURN relay being released.
 *
 * Lifecycle: proposed → accepted → active → revoked
 *            proposed → rejected
 *            proposed → expired (24h TTL)
 */

import { prisma } from '@/lib/prisma';
import { DirectConnectionStatus } from '@prisma/client';
import crypto from 'crypto';

// ── Constants ────────────────────────────────────────────

/** How long a proposal stays valid before auto-expiring (ms). */
export const PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** Statuses that indicate a "live" connection (blocks new proposals). */
export const ACTIVE_STATUSES: DirectConnectionStatus[] = [
  DirectConnectionStatus.proposed,
  DirectConnectionStatus.accepted,
  DirectConnectionStatus.active,
];

// ── Types ────────────────────────────────────────────────

interface ProposeResult {
  ok: true;
  connectionId: string;
  expiresAt: Date;
}

interface ProposeError {
  ok: false;
  reason: string;
  code: 'policy_denied' | 'already_exists' | 'no_endpoint' | 'self_connection';
}

interface AcceptResult {
  ok: true;
  connectionId: string;
  /** Proposer's real A2A endpoint — share with target. */
  proposerEndpoint: string;
  /** Target's real A2A endpoint — share with proposer. */
  targetEndpoint: string;
  /** One-time upgrade token for the first direct request. */
  upgradeToken: string;
  /** Proposer's Ed25519 public key for direct verification. */
  proposerPublicKey: string;
  /** Target's Ed25519 public key for direct verification. */
  targetPublicKey: string;
}

interface ActionError {
  ok: false;
  reason: string;
  code: 'not_found' | 'not_authorized' | 'invalid_state' | 'no_endpoint';
}

interface VerifyTokenResult {
  ok: true;
  connectionId: string;
  proposerAgentId: string;
  targetAgentId: string;
}

interface VerifyTokenError {
  ok: false;
  reason: string;
}

// ── Propose ──────────────────────────────────────────────

/**
 * Propose a direct connection upgrade (ICE Offer).
 *
 * Pre-conditions:
 *   - Proposer must have an endpointUrl (you can't offer a direct connection
 *     if you have nothing to connect to)
 *   - Target's directConnectionPolicy must not be `carrier_only`
 *   - No existing active/pending connection between this pair
 *   - Cannot propose to yourself
 */
export async function proposeDirectConnection(
  proposerAgentId: string,
  targetAgentId: string,
): Promise<ProposeResult | ProposeError> {
  if (proposerAgentId === targetAgentId) {
    return { ok: false, reason: 'Cannot propose direct connection to yourself', code: 'self_connection' };
  }

  const [proposer, target] = await Promise.all([
    prisma.agent.findUnique({
      where: { id: proposerAgentId, isActive: true },
      select: { id: true, endpointUrl: true, directConnectionPolicy: true },
    }),
    prisma.agent.findUnique({
      where: { id: targetAgentId, isActive: true },
      select: { id: true, endpointUrl: true, directConnectionPolicy: true },
    }),
  ]);

  if (!proposer || !target) {
    return { ok: false, reason: 'Agent not found', code: 'not_found' };
  }

  // The proposer must have an endpoint to offer
  if (!proposer.endpointUrl) {
    return { ok: false, reason: 'Proposer has no endpoint URL configured', code: 'no_endpoint' };
  }

  // Target's policy check — carrier_only agents refuse ALL upgrade proposals
  if (target.directConnectionPolicy === 'carrier_only') {
    return { ok: false, reason: 'Target agent policy requires carrier-only relay', code: 'policy_denied' };
  }

  // Proposer's own policy — a carrier_only agent shouldn't propose either
  if (proposer.directConnectionPolicy === 'carrier_only') {
    return { ok: false, reason: 'Your agent policy requires carrier-only relay', code: 'policy_denied' };
  }

  // Check for existing active/pending connection (either direction)
  const existing = await prisma.directConnection.findFirst({
    where: {
      OR: [
        { proposerAgentId, targetAgentId, status: { in: ACTIVE_STATUSES } },
        { proposerAgentId: targetAgentId, targetAgentId: proposerAgentId, status: { in: ACTIVE_STATUSES } },
      ],
    },
  });

  if (existing) {
    return { ok: false, reason: 'Active or pending connection already exists', code: 'already_exists' };
  }

  // Clean up any old rejected/revoked/expired connections for this pair
  await prisma.directConnection.deleteMany({
    where: {
      OR: [
        { proposerAgentId, targetAgentId, status: { notIn: ACTIVE_STATUSES } },
        { proposerAgentId: targetAgentId, targetAgentId: proposerAgentId, status: { notIn: ACTIVE_STATUSES } },
      ],
    },
  });

  const expiresAt = new Date(Date.now() + PROPOSAL_TTL_MS);

  const connection = await prisma.directConnection.create({
    data: {
      proposerAgentId,
      targetAgentId,
      status: DirectConnectionStatus.proposed,
      expiresAt,
    },
  });

  return { ok: true, connectionId: connection.id, expiresAt };
}

// ── Accept ───────────────────────────────────────────────

/**
 * Accept a direct connection proposal (ICE Answer).
 *
 * This is the critical step where the carrier performs the "candidate exchange":
 * it generates a one-time upgrade token and shares both agents' endpoint URLs.
 *
 * Like ICE, after this exchange the agents have each other's transport addresses
 * and can perform direct connectivity. The upgrade token is analogous to ICE's
 * binding request transaction ID — it proves the direct connection was authorized
 * by the carrier.
 */
export async function acceptDirectConnection(
  connectionId: string,
  acceptingAgentId: string,
): Promise<AcceptResult | ActionError> {
  const connection = await prisma.directConnection.findUnique({
    where: { id: connectionId },
    include: {
      proposerAgent: { select: { id: true, endpointUrl: true, publicKey: true } },
      targetAgent: { select: { id: true, endpointUrl: true, publicKey: true } },
    },
  });

  if (!connection) {
    return { ok: false, reason: 'Connection not found', code: 'not_found' };
  }

  // Only the target can accept (ICE: controlled agent sends answer)
  if (connection.targetAgentId !== acceptingAgentId) {
    return { ok: false, reason: 'Only the target agent can accept a proposal', code: 'not_authorized' };
  }

  if (connection.status !== DirectConnectionStatus.proposed) {
    return { ok: false, reason: `Connection is ${connection.status}, expected proposed`, code: 'invalid_state' };
  }

  if (connection.expiresAt < new Date()) {
    await prisma.directConnection.update({
      where: { id: connectionId },
      data: { status: DirectConnectionStatus.expired },
    });
    return { ok: false, reason: 'Proposal has expired', code: 'invalid_state' };
  }

  // Both agents must have endpoints for the exchange
  if (!connection.proposerAgent.endpointUrl) {
    return { ok: false, reason: 'Proposer has no endpoint URL', code: 'no_endpoint' };
  }
  if (!connection.targetAgent.endpointUrl) {
    return { ok: false, reason: 'Target has no endpoint URL — configure one before accepting', code: 'no_endpoint' };
  }

  // Generate the upgrade token (like a TURN allocation token / ICE transaction ID)
  // 32 bytes = 256 bits of entropy, base64url-encoded
  const upgradeToken = crypto.randomBytes(32).toString('base64url');

  await prisma.directConnection.update({
    where: { id: connectionId },
    data: {
      status: DirectConnectionStatus.accepted,
      upgradeToken,
      proposerEndpoint: connection.proposerAgent.endpointUrl,
      targetEndpoint: connection.targetAgent.endpointUrl,
      acceptedAt: new Date(),
    },
  });

  return {
    ok: true,
    connectionId,
    proposerEndpoint: connection.proposerAgent.endpointUrl,
    targetEndpoint: connection.targetAgent.endpointUrl,
    upgradeToken,
    proposerPublicKey: connection.proposerAgent.publicKey ?? '',
    targetPublicKey: connection.targetAgent.publicKey ?? '',
  };
}

// ── Reject ───────────────────────────────────────────────

/**
 * Reject a direct connection proposal.
 */
export async function rejectDirectConnection(
  connectionId: string,
  rejectingAgentId: string,
): Promise<{ ok: true } | ActionError> {
  const connection = await prisma.directConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    return { ok: false, reason: 'Connection not found', code: 'not_found' };
  }

  if (connection.targetAgentId !== rejectingAgentId) {
    return { ok: false, reason: 'Only the target agent can reject a proposal', code: 'not_authorized' };
  }

  if (connection.status !== DirectConnectionStatus.proposed) {
    return { ok: false, reason: `Connection is ${connection.status}, expected proposed`, code: 'invalid_state' };
  }

  await prisma.directConnection.update({
    where: { id: connectionId },
    data: { status: DirectConnectionStatus.rejected },
  });

  return { ok: true };
}

// ── Revoke ───────────────────────────────────────────────

/**
 * Revoke a direct connection (analogous to SIP BYE).
 *
 * Either party can revoke at any time. This tears down the connection:
 * - Endpoints are cleared (no longer shared)
 * - Upgrade token is invalidated
 * - Post-revocation: traffic must go through the carrier again
 *
 * This is a unilateral action — the revoking party doesn't need consent.
 * Like hanging up a phone call.
 */
export async function revokeDirectConnection(
  connectionId: string,
  revokingAgentId: string,
): Promise<{ ok: true } | ActionError> {
  const connection = await prisma.directConnection.findUnique({
    where: { id: connectionId },
  });

  if (!connection) {
    return { ok: false, reason: 'Connection not found', code: 'not_found' };
  }

  // Either party may revoke
  if (connection.proposerAgentId !== revokingAgentId && connection.targetAgentId !== revokingAgentId) {
    return { ok: false, reason: 'Only a participant can revoke a connection', code: 'not_authorized' };
  }

  const revocableStatuses: DirectConnectionStatus[] = [
    DirectConnectionStatus.proposed,
    DirectConnectionStatus.accepted,
    DirectConnectionStatus.active,
  ];

  if (!revocableStatuses.includes(connection.status)) {
    return { ok: false, reason: `Connection is ${connection.status}, cannot revoke`, code: 'invalid_state' };
  }

  await prisma.directConnection.update({
    where: { id: connectionId },
    data: {
      status: DirectConnectionStatus.revoked,
      revokedAt: new Date(),
      revokedBy: revokingAgentId,
      // Clear shared endpoints — privacy restored
      proposerEndpoint: null,
      targetEndpoint: null,
    },
  });

  return { ok: true };
}

// ── Verify Upgrade Token ─────────────────────────────────

/**
 * Verify and consume an upgrade token (ICE connectivity check).
 *
 * The first direct A2A request between agents MUST include the upgrade token
 * (via `molt.upgrade_token` in metadata). The receiving agent can verify it
 * against the carrier to confirm the connection was legitimately authorized.
 *
 * The token is single-use: once consumed, the connection moves to `active`.
 * Subsequent direct requests rely on Ed25519 verification (public keys were
 * exchanged during the accept phase).
 */
export async function verifyAndConsumeUpgradeToken(
  token: string,
): Promise<VerifyTokenResult | VerifyTokenError> {
  const connection = await prisma.directConnection.findUnique({
    where: { upgradeToken: token },
  });

  if (!connection) {
    return { ok: false, reason: 'Invalid upgrade token' };
  }

  if (connection.status !== DirectConnectionStatus.accepted) {
    return { ok: false, reason: `Connection is ${connection.status}, expected accepted` };
  }

  if (connection.tokenConsumed) {
    return { ok: false, reason: 'Upgrade token already consumed' };
  }

  await prisma.directConnection.update({
    where: { id: connection.id },
    data: {
      status: DirectConnectionStatus.active,
      tokenConsumed: true,
      activatedAt: new Date(),
    },
  });

  return {
    ok: true,
    connectionId: connection.id,
    proposerAgentId: connection.proposerAgentId,
    targetAgentId: connection.targetAgentId,
  };
}

// ── Query ────────────────────────────────────────────────

/**
 * List direct connections for an agent (as proposer or target).
 */
export async function listDirectConnections(
  agentId: string,
  opts: { status?: DirectConnectionStatus; limit?: number } = {},
) {
  const limit = Math.min(opts.limit ?? 50, 100);
  return prisma.directConnection.findMany({
    where: {
      OR: [
        { proposerAgentId: agentId },
        { targetAgentId: agentId },
      ],
      ...(opts.status ? { status: opts.status } : {}),
    },
    include: {
      proposerAgent: { select: { id: true, displayName: true, phoneNumber: true } },
      targetAgent: { select: { id: true, displayName: true, phoneNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Check if two agents have an active direct connection.
 */
export async function hasActiveDirectConnection(
  agentId1: string,
  agentId2: string,
): Promise<boolean> {
  const connection = await prisma.directConnection.findFirst({
    where: {
      OR: [
        { proposerAgentId: agentId1, targetAgentId: agentId2 },
        { proposerAgentId: agentId2, targetAgentId: agentId1 },
      ],
      status: DirectConnectionStatus.active,
    },
  });
  return !!connection;
}

/**
 * Expire stale proposals (cron job).
 * Returns the count of expired proposals.
 */
export async function expireStaleProposals(): Promise<number> {
  const result = await prisma.directConnection.updateMany({
    where: {
      status: DirectConnectionStatus.proposed,
      expiresAt: { lt: new Date() },
    },
    data: { status: DirectConnectionStatus.expired },
  });
  return result.count;
}

// ── Auto-accept for direct_on_accept policy ──────────────

/**
 * For agents with `direct_on_accept` policy, the carrier auto-accepts
 * proposals during the propose step. This is like ICE Lite — the controlled
 * agent automatically generates an answer.
 *
 * Returns the full accept result if auto-accepted, or null if manual.
 */
export async function maybeAutoAccept(
  connectionId: string,
  targetAgentId: string,
): Promise<AcceptResult | null> {
  const target = await prisma.agent.findUnique({
    where: { id: targetAgentId, isActive: true },
    select: { directConnectionPolicy: true },
  });

  if (target?.directConnectionPolicy !== 'direct_on_accept') {
    return null;
  }

  const result = await acceptDirectConnection(connectionId, targetAgentId);
  return result.ok ? result : null;
}
