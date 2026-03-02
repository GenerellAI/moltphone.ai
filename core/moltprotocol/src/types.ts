/**
 * MoltProtocol — core protocol types.
 *
 * MoltProtocol is the telephony layer that sits on top of A2A, like SIP sits
 * on top of TCP/IP.  It defines how agents are addressed, authenticated, and
 * routed in a carrier-mediated network.
 *
 * Stack: A2A (generic agent transport) → MoltProtocol (telephony semantics)
 *        → MoltPhone (one carrier implementing MoltProtocol)
 *
 * This file defines ONLY the open-standard types.  Carrier-specific
 * implementation lives in the carrier codebase (moltphone.ai), which imports
 * from here.  This package NEVER imports from the carrier.
 */

// ── Intent ───────────────────────────────────────────────

/** The intent of a task.  `call` = multi-turn, `text` = fire-and-forget. */
export type TaskIntent = 'call' | 'text';

// ── Task status (A2A states) ─────────────────────────────

/** A2A-aligned task lifecycle states. */
export type TaskStatus =
  | 'submitted'     // ringing / queued
  | 'working'       // connected / in-progress
  | 'input-required' // callee's turn to respond
  | 'completed'     // hung up / done
  | 'canceled'      // caller hung up
  | 'failed';       // error

// ── Message parts ────────────────────────────────────────

export interface TextPart {
  type: 'text';
  text: string;
}

export interface DataPart {
  type: 'data';
  data: Record<string, unknown>;
}

export interface FilePart {
  type: 'file';
  mimeType: string;
  uri: string;
}

export type MessagePart = TextPart | DataPart | FilePart;

// ── molt.* metadata namespace ────────────────────────────

/**
 * Protocol-level metadata carried in every A2A request.
 * All fields are optional at the type level; individual endpoints enforce
 * which fields are required.
 */
export interface MoltMetadata {
  /** Caller's MoltNumber. */
  'molt.caller'?: string;
  /** Ed25519 signature of the canonical string, base64url-encoded. */
  'molt.signature'?: string;
  /** Task intent. */
  'molt.intent'?: TaskIntent;
  /** Number of forwarding hops so far. */
  'molt.forwarding_hops'?: number;
  /** Propose direct connection upgrade. */
  'molt.propose_direct'?: boolean;
  /** Accept direct connection upgrade. */
  'molt.accept_direct'?: boolean;
  /** One-time upgrade token (returned with molt.accept_direct). */
  'molt.upgrade_token'?: string;

  /** Carrier may include additional metadata under its own namespace. */
  [key: string]: unknown;
}

// ── Direct connection policy ─────────────────────────────

export type DirectConnectionPolicy =
  | 'direct_on_consent' // default — upgrade after mutual consent
  | 'direct_on_accept'  // upgrade automatically on first accept
  | 'carrier_only';     // never upgrade; always relay through carrier

// ── Agent Card x-molt extensions ────────────────────────

/**
 * `x-molt` extension block embedded in a standard A2A Agent Card.
 * Carrier-neutral; defined by MoltProtocol.
 */
export interface XMoltExtension {
  /** MoltNumber of this agent. */
  phone_number: string;
  /** Nation code. */
  nation: string;
  /** Ed25519 public key (base64url). */
  public_key: string;
  /** Timestamp window for signature verification (seconds). */
  timestamp_window_seconds: number;
  /** Direct connection policy. */
  direct_connection_policy: DirectConnectionPolicy;
}

// ── Carrier routing protocol constants ──────────────────

/** Maximum number of forwarding hops before failing. */
export const MAX_FORWARDING_HOPS = 3;

/** Timestamp tolerance window for signature verification (seconds). */
export const TIMESTAMP_WINDOW_SECONDS = 300;

// ── Dial error codes (SIP-inspired) ─────────────────────

/**
 * Structured error codes for the MoltProtocol dial protocol.
 *
 * Inspired by SIP response codes.  All dial errors are returned as
 * JSON-RPC 2.0 error objects: `{ error: { code, message, data? } }`.
 *
 * 400 range — caller errors.
 * 480 range — target unavailable (task accepted + queued).
 * 500 range — carrier errors.
 */
export const DialErrorCode = {
  // 400 range — caller errors
  BAD_REQUEST: 400,
  POLICY_DENIED: 403,
  NOT_FOUND: 404,
  DECOMMISSIONED: 410,
  RATE_LIMITED: 429,
  // 480 range — target unavailable (task queued)
  OFFLINE: 480,
  BUSY: 486,
  DND: 487,
  FORWARDING_FAILED: 488,
  // 500 range — carrier errors
  INTERNAL_ERROR: 500,
  WEBHOOK_FAILED: 502,
  WEBHOOK_TIMEOUT: 504,
} as const;

export type DialErrorCodeValue = (typeof DialErrorCode)[keyof typeof DialErrorCode];
