/**
 * Carrier Configuration
 * =====================
 *
 * This is the single file you edit to run your own MoltProtocol carrier.
 * Every carrier-specific value — name, domain, branding, defaults — lives
 * here. The rest of the codebase reads from this config.
 *
 * To start your own carrier:
 *   1. Fork this repo
 *   2. Edit this file
 *   3. Set the matching env vars (.env)
 *   4. Deploy
 *
 * Environment variables override config values where noted. This lets you
 * use the same code across staging / production without changing the file.
 */

// ── Identity ─────────────────────────────────────────────

/** Carrier domain — the public domain where this carrier is reachable.
 *  Override: CARRIER_DOMAIN env var. */
export const CARRIER_DOMAIN =
  process.env.CARRIER_DOMAIN || 'moltphone.ai';

/** Human-readable carrier name. Shown in Agent Cards, UI, emails. */
export const CARRIER_NAME =
  process.env.CARRIER_NAME || 'MoltPhone';

/** Carrier tagline / description. */
export const CARRIER_DESCRIPTION =
  process.env.CARRIER_DESCRIPTION || 'AI Agent Carrier';

/** Carrier website URL (used in Agent Card `provider.url`). */
export const CARRIER_URL =
  process.env.CARRIER_URL || `https://${CARRIER_DOMAIN}`;

// ── Call / A2A endpoints ─────────────────────────────────

/** Base URL for call routes (no trailing slash).
 *  In production: https://call.example.com
 *  In development: http://call.localhost:3000 */
export const CALL_BASE_URL =
  process.env.CALL_BASE_URL || 'http://call.localhost:3000';

/** The hostname used for the call subdomain. Used by middleware to detect
 *  inbound subdomain requests. Override: CALL_HOST env var. */
export const CALL_HOST =
  process.env.CALL_HOST || 'call.localhost:3000';

// ── Default nation ───────────────────────────────────────

/** The carrier's primary nation code (created in seed). */
export const DEFAULT_NATION_CODE =
  process.env.DEFAULT_NATION_CODE || 'MOLT';

/** Display name for the default nation. */
export const DEFAULT_NATION_NAME =
  process.env.DEFAULT_NATION_NAME || CARRIER_NAME;

/** Badge/emoji for the default nation (optional). */
export const DEFAULT_NATION_BADGE =
  process.env.DEFAULT_NATION_BADGE || '🪼';

// ── Branding ─────────────────────────────────────────────

/** Site title (used in <title> tag and metadata). */
export const SITE_TITLE =
  process.env.SITE_TITLE || `${CARRIER_NAME} - ${CARRIER_DESCRIPTION}`;

/** Demo user email (used in seed and login page hint). */
export const DEMO_EMAIL =
  process.env.DEMO_EMAIL || `demo@${CARRIER_DOMAIN}`;

/** Demo user password. */
export const DEMO_PASSWORD =
  process.env.DEMO_PASSWORD || 'demo1234';

/** System user email (used in seed). */
export const SYSTEM_EMAIL =
  process.env.SYSTEM_EMAIL || `system@${CARRIER_DOMAIN}`;

// ── Limits & defaults ────────────────────────────────────

/** Presence TTL in seconds. Agent is "online" if heartbeat within this window. */
export const PRESENCE_TTL_SECONDS =
  Number(process.env.PRESENCE_TTL_SECONDS) || 300;

/** Default max concurrent tasks per agent. */
export const DEFAULT_MAX_CONCURRENT_TASKS = 3;

/** Rate limit: requests per window per caller. */
export const RATE_LIMIT_MAX =
  Number(process.env.RATE_LIMIT_MAX) || 60;

/** Rate limit: window size in milliseconds. */
export const RATE_LIMIT_WINDOW_MS =
  Number(process.env.RATE_LIMIT_WINDOW_MS) || 60_000;

/** Signup credit grant for new users. */
export const SIGNUP_CREDITS =
  Number(process.env.SIGNUP_CREDITS) || 10_000;

// ── Task retention ───────────────────────────────────────

/** Maximum number of tasks stored per agent (caller + callee combined).
 *  When exceeded, oldest completed/canceled tasks are pruned on new task creation.
 *  0 = unlimited. Override: MAX_TASKS_PER_AGENT env var. */
export const MAX_TASKS_PER_AGENT =
  Number(process.env.MAX_TASKS_PER_AGENT) || 1000;

/** Days to retain completed/canceled tasks before the cleanup cron deletes them.
 *  Override: TASK_RETENTION_DAYS env var. */
export const TASK_RETENTION_DAYS =
  Number(process.env.TASK_RETENTION_DAYS) || 30;

// ── Registry ─────────────────────────────────────────────

/** Registry mode: 'local' (single-carrier, registry is the local DB) or
 *  'remote' (federated, queries an external registry at REGISTRY_URL). */
export const REGISTRY_MODE =
  (process.env.REGISTRY_MODE as 'local' | 'remote') || 'local';

/** Registry URL for remote mode. Ignored when REGISTRY_MODE=local. */
export const REGISTRY_URL =
  process.env.REGISTRY_URL || 'https://registry.moltprotocol.org';

// ── Feature flags ────────────────────────────────────────

/** Enable the MoltCredits economy (balance display, creation costs, relay charges).
 *  When false, all credit checks are bypassed and credit UI is hidden.
 *  Default: false — avoids scaring new users into thinking this is a paid service. */
export const CREDITS_ENABLED =
  process.env.CREDITS_ENABLED === 'true';

/** Enable cross-carrier routing (requires REGISTRY_MODE=remote). */
export const CROSS_CARRIER_ROUTING =
  process.env.CROSS_CARRIER_ROUTING === 'true';

/** Enable number portability import/export. */
export const NUMBER_PORTABILITY =
  process.env.NUMBER_PORTABILITY === 'true';
