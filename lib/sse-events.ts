/**
 * Cross-instance event distribution for SSE streams.
 *
 * Uses an in-memory EventEmitter for same-instance delivery.
 * Cross-instance delivery relies on DB polling (clients reconnect via
 * `Last-Event-ID` and catch up from TaskEvent records).
 *
 * Architecture:
 *   Task event created (send/reply/cancel/retry)
 *     → publishTaskEvent(agentIds, event)
 *       → In-memory EventEmitter emit
 *
 *   SSE route opened
 *     → subscribeToAgents(agentIds, callback)
 *       → In-memory EventEmitter listener
 *       → Returns unsubscribe function
 *
 * Note: Redis Pub/Sub is not used because the Upstash HTTP client does not
 * support SUBSCRIBE (requires a persistent TCP connection). For Cloudflare
 * Workers, which are short-lived isolates, in-memory + DB polling is the
 * correct pattern. Events are persisted in the TaskEvent table for durability
 * and cross-instance catch-up.
 */

import { EventEmitter } from 'events';

// ── Types ────────────────────────────────────────────────

export interface SSETaskEvent {
  eventId: string;
  taskId: string;
  type: string;
  payload: unknown;
  task?: {
    id: string;
    status: string;
    intent: string;
    callee?: { id: string; moltNumber: string; displayName: string };
    caller?: { id: string; moltNumber: string; displayName: string } | null;
  };
  timestamp: string;
  sequenceNumber: number;
}

type EventCallback = (event: SSETaskEvent) => void;

// ── In-memory EventEmitter ───────────────────────────────

const localEmitter = new EventEmitter();
localEmitter.setMaxListeners(1000); // SSE connections can be many

// ── Publish ──────────────────────────────────────────────

/**
 * Publish a task event to all SSE subscribers for the given agents.
 *
 * @param agentIds  Agent IDs involved in the task (callee + caller)
 * @param event     The event payload to distribute
 */
export async function publishTaskEvent(
  agentIds: string[],
  event: SSETaskEvent,
): Promise<void> {
  for (const id of agentIds) {
    localEmitter.emit(`agent:${id}`, event);
  }
}

// ── Subscribe ────────────────────────────────────────────

/**
 * Subscribe to task events for a set of agents.
 * Returns an unsubscribe function.
 *
 * @param agentIds  Agent IDs to subscribe to
 * @param callback  Called for each matching event
 * @returns         Cleanup function — MUST be called when SSE connection closes
 */
export function subscribeToAgents(
  agentIds: string[],
  callback: EventCallback,
): () => void {
  const localListeners: Array<{ channel: string; listener: EventCallback }> = [];

  for (const id of agentIds) {
    const localChannel = `agent:${id}`;

    const safeCallback = (event: SSETaskEvent) => {
      try { callback(event); } catch { /* consumer error */ }
    };
    localEmitter.on(localChannel, safeCallback);
    localListeners.push({ channel: localChannel, listener: safeCallback });
  }

  // Return cleanup function
  return () => {
    for (const { channel, listener } of localListeners) {
      localEmitter.removeListener(channel, listener);
    }
  };
}

/**
 * Clean up event resources (for graceful shutdown / tests).
 */
export async function disconnectSSEEvents(): Promise<void> {
  localEmitter.removeAllListeners();
}
