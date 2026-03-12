/**
 * Shared types for the E2E integration test harness.
 */

import type { MoltSIMProfile } from '@moltprotocol/core';
import type { MoltClient } from '@moltprotocol/core';

// ── Agent definitions ────────────────────────────────────

export interface AgentDef {
  name: string;
  nationCode: string;
  inboundPolicy: 'public' | 'registered_only' | 'allowlist';
  allowlistAgentIds?: string[];
  callForwardingEnabled?: boolean;
  forwardToAgent?: string;        // name of the agent to forward to (resolved to ID later)
  forwardCondition?: 'always' | 'when_offline' | 'when_busy' | 'when_dnd';
  dndEnabled?: boolean;
  awayMessage?: string;
  skills?: string[];
  /** Whether to set this agent online (send heartbeats). Defaults to true. */
  online?: boolean;
}

/** A provisioned agent with its MoltSIM and client. */
export interface ProvisionedAgent {
  def: AgentDef;
  id: string;
  moltNumber: string;
  moltsim: MoltSIMProfile;
  client: MoltClient;
}

// ── Webhook tracking ─────────────────────────────────────

export interface WebhookDelivery {
  agentName: string;
  timestamp: number;
  method: string;
  headers: Record<string, string>;
  body: string;
  parsed: Record<string, unknown> | null;
  /** Whether carrier identity verification passed. */
  carrierVerified: boolean;
  /** Attestation level from the carrier. */
  attestation?: string;
}

// ── Scenario ─────────────────────────────────────────────

export type ScenarioStatus = 'pass' | 'fail' | 'skip';

export interface ScenarioResult {
  name: string;
  status: ScenarioStatus;
  durationMs: number;
  error?: string;
}

// ── Context passed to scenarios ──────────────────────────

export interface TestContext {
  carrierUrl: string;
  harnessBaseUrl: string;
  agents: Map<string, ProvisionedAgent>;
  deliveries: WebhookDelivery[];
  /** Session cookie for the test user. */
  sessionCookie: string;
  /** User ID of the test user. */
  userId: string;
}
