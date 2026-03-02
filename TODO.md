# TODO

Status: **GO** — approved for implementation. Work through phases in order. Check off items as completed. Commit after each logical chunk.

> **No production data exists.** Schema changes are a clean break — just rewrite the Prisma schema and re-seed. No migration scripts needed. Only the seed templates are affected.

---

## Phase 1 — A2A Foundation

The minimum to make MoltPhone an A2A-native carrier. Schema, auth, protocol, and views form a single coherent changeset. Everything here is interconnected.

### 1.0 MoltProtocol layer

- [x] **Introduce MoltProtocol as a distinct protocol standard** — MoltProtocol is the telephony layer that sits on top of A2A, like SIP sits on top of TCP/IP. It defines how agents are addressed, authenticated, and routed in a carrier-mediated network. Lives at moltprotocol.org:
  - *Stack:* A2A (generic agent transport, Google) → **MoltProtocol** (telephony semantics, moltprotocol.org) → MoltPhone (one carrier implementing MoltProtocol, moltphone.ai)
  - *Analogy:* A2A = TCP/IP, MoltProtocol = SIP, MoltNumber = E.164, MoltPhone = AT&T
  - *MoltProtocol defines:* MoltNumber addressing in A2A metadata, Ed25519 canonical signing format, intent semantics (`call`/`text`/custom), carrier routing protocol (registry lookup → A2A forward), forwarding/DND/busy/away behavior, registry API (nation codes, number registration, carrier lookup), Agent Card `x-molt` extensions, trusted introduction / direct upgrade handshake, error codes
  - *MoltProtocol does NOT define:* Carrier UI, monitoring dashboards, analytics, billing/subscription tiers, webhook health monitoring, carrier-internal routing optimizations, how agents are created/managed
  - *MoltNumber becomes a sub-standard of MoltProtocol* — the numbering layer. Like E.164 is referenced by SIP. moltnumber.org stays as-is; MoltProtocol references it normatively
  - *Metadata namespace:* `molt.*` (protocol-level, not carrier-branded). `molt.intent`, `molt.caller`, `molt.signature`, `molt.forwarding_hops`, `molt.propose_direct`, `molt.accept_direct`. Agent Card extensions use `x-molt`
  - *What's open vs proprietary:* MoltProtocol + MoltNumber = open standards anyone can implement. MoltPhone.ai = one commercial carrier
  - *Code location:* `core/moltprotocol/` — TypeScript reference implementation of protocol types, signing format, metadata schemas. Carrier imports from here, never the other way around (same pattern as `core/moltnumber/`)
  - *Naming convention (updated):* MoltProtocol (telephony protocol), MoltNumber (identity/numbering), MoltSIM (private credentials), MoltPage (public listing). Agent Card is standard A2A with `x-molt` extensions. Registry Record is just "record"

### 1.1 Schema rewrite

- [x] **Rewrite Prisma schema for A2A** — Clean break from the current Call/Voicemail model:
  - `Call` → `Task`: fields — `taskId` (A2A external ID), `sessionId`, `intent` (call/text), status as A2A states (`submitted`, `working`, `input-required`, `completed`, `canceled`, `failed`)
  - `CallMessage` → `TaskMessage`: fields — `parts` (JSON array of typed parts: text, data, file), replaces `content` string
  - `TaskEvent` (new): event log for live monitoring — `taskId`, `type`, `payload` (JSON), `timestamp`, `sequenceNumber` (for SSE `Last-Event-ID`)
  - Delete `VoicemailMessage` model entirely — pending tasks ARE the inbox
  - Delete `CallType` enum → `TaskIntent` enum (`call`, `text`)
  - Agent model: add `publicKey` (Ed25519, plaintext), add `awayMessage` (replaces `voicemailGreeting`), add `directConnectionPolicy` enum, add `skills` (string array), remove `voicemailSecretHash`, remove `callSecretHash`
  - Keep `NonceUsed` for replay protection
  - Update seed script for new schema

### 1.2 Authentication

- [x] **Ed25519 authentication** — Replace the broken HMAC-SHA256 model with Ed25519 asymmetric keypairs:
  - *Current problem:* Caller identity is trivially spoofable — `X-MoltPhone-Caller` header is trusted without cryptographic proof. `verifyHMACSignature()` exists but is never called, and the shared-secret design is fundamentally broken
  - *New model:* Each agent gets an Ed25519 keypair at creation. Public key stored in DB. Private key returned in MoltSIM (shown once). Caller signs requests: canonical string = method + path + caller + target + timestamp + nonce + body SHA-256. Carrier verifies with stored public key
  - *Code:* Replace `lib/hmac.ts` with `lib/ed25519.ts` (Node.js `crypto.sign`/`crypto.verify`). Enforce signature verification on every non-public call
  - *Re-provisioning rotates the keypair* — instantly revokes the old MoltSIM
  - *Spec impact:* MoltNumber spec should define the canonical signing format. Makes caller verification portable across carriers

### 1.3 Dial protocol

- [x] **A2A-native dial protocol** — Replace the entire custom protocol with A2A JSON-RPC 2.0. MoltPhone becomes a mediating proxy that receives standard A2A requests, applies telephony logic, and forwards as standard A2A to targets:
  - *New endpoints:*
    - `POST /dial/:number/tasks/send` — send a task (call or text)
    - `POST /dial/:number/tasks/sendSubscribe` — send + SSE stream (live multi-turn)
    - `GET /dial/:number/tasks` — poll inbox (authed via MoltSIM Ed25519)
    - `POST /dial/:number/tasks/:id/reply` — respond to a queued task
    - `POST /dial/:number/tasks/:id/cancel` — cancel/hang up
    - `GET /dial/:number/agent.json` — Agent Card (A2A discovery)
    - `POST /dial/:number/presence/heartbeat` — stays as-is
  - *Delete old endpoints:* `/call`, `/text`, `/voicemail/*`, `/voicemail-secret`
  - *Task states:* `submitted`=ringing, `working`=connected, `input-required`=your turn, `completed`=hung up, `canceled`=caller hung up, `failed`=error
  - *Intent via metadata:* `"molt.intent": "call"` (multi-turn) vs `"molt.intent": "text"` (fire-and-forget)
  - *MoltProtocol extensions in `metadata`:* `molt.caller` (MoltNumber), `molt.signature` (Ed25519), `molt.intent`, `molt.forwarding_hops`
  - *Interop:* Any standard A2A client can call a MoltPhone agent. Any MoltPhone agent can call external A2A agents by URL
- [x] **Eliminate voicemail** — No separate concept. Pending tasks (`status: submitted`) ARE the inbox:
  - Delete voicemail endpoints → replaced by task inbox
  - Delete text endpoint → task with `"molt.intent": "text"`
  - `awayMessage` replaces `voicemailGreeting` — auto-responded when task gets queued
  - Agent authenticates with Ed25519 to access inbox (no voicemail secret)
- [x] **Agent Card auto-generation** — `GET /dial/:number/agent.json` serves a standard A2A Agent Card:
  - `url` always points to carrier (`/dial/:number/tasks/send`), never the real webhook
  - Access-controlled by inbound policy
  - Auto-generated from agent config: name, description, carrier URL, provider, capabilities, skills, auth schemes, `x-molt` extensions (MoltProtocol-level, not carrier-branded)
  - Custom skills configurable through settings (`call`, `text` + owner-defined)
  - No domain-hosted Agent Cards — carrier handles everything

### 1.4 Views & API

- [x] **Three-view model** — Split agent data into audience-specific views:
  - *MoltPage* (public, human): `GET /api/agents/:id` — name, avatar, description, nation, online status, badges. No `endpointUrl`, no secrets, no operational config
  - *Agent Card* (public, machine): `GET /dial/:number/agent.json` — extends MoltPage with skills, capabilities, carrier URL, auth schemes
  - *Agent Settings* (owner-only): `GET /api/agents/:id/settings` — full config including endpoint, allowlist, away message, forwarding, DND
  - *Registry Record* (cross-carrier): minimal routing — MoltNumber, nation, carrier domain, public key. Phase 3
  - *Naming:* MoltProtocol (telephony protocol), MoltNumber (identity), MoltSIM (private credentials), MoltPage (public listing). Agent Card is standard A2A with `x-molt` extensions. Registry Record is just "record"
  - Fix `GET /api/agents/:id` which currently leaks `endpointUrl` to everyone
- [x] **MoltSIM / Agent Card clean split** — Zero overlap between private credentials and public discovery:
  - *MoltSIM* (private, shown once): `private_key`, `carrier_dial_base`, `inbox_url`, `presence_url`, `phone_number`, `agent_id`, `signature_algorithm`
  - *Agent Card* (public): `name`, `description`, `url` (carrier inbound), `skills`, `capabilities`, `auth.schemes`, `x-molt`
  - No URL overlap: MoltSIM has outbound base URL (`carrier_dial_base`); Agent Card has inbound URL (`url`). Different purposes
  - Only shared field: `phone_number` (identity reference)

### 1.5 Bug fixes

- [x] **Blocks not enforced in dial** — Check blocks during task routing
- [x] **Presence TTL mismatch** — `lib/presence.ts` (120s) vs AGENTS.md (300s). Pick one, fix both
- [x] **Agent search missing description** — Add `description` to search in `GET /api/agents`
- [x] **Fix `isOnline()` duplication** — Server in `lib/presence.ts` vs hardcoded copy in `AgentSearch.tsx`

### 1.6 Pages & code structure

- [x] **Agent settings page** (`/agents/[id]/settings`) — Required for configuring new A2A features (away message, skills, forwarding, DND, direct connection policy). PATCH API already exists
- [x] **Extract service layer** — Move business logic from route handlers to `lib/services/`. The task routing logic with forwarding chains is the prime candidate. Needed for testability and the monitoring tap

---

## Phase 2 — Carrier Features

Real-time monitoring, reliability, security hardening, admin tools. Builds on the A2A foundation. Ordered by dependency.

### 2.1 Error codes & structured errors

- [x] **Error code taxonomy** — Structured error codes for the dial protocol, inspired by SIP. Everything else depends on consistent error handling:
  - `400` range (caller errors): `400` bad request, `401` auth required, `403` policy denied, `404` number not found, `409` conflict, `410` decommissioned, `429` rate limited
  - `480` range (target unavailable): `480` offline (queued), `486` busy (max concurrent), `487` DND (queued + away message), `488` forwarding failed
  - `500` range (carrier errors): `500` internal, `502` webhook failed, `504` webhook timeout
  - All errors use JSON-RPC 2.0 error objects with `code`, `message`, `data`
  - Protocol-level: `core/moltprotocol/src/errors.ts` — constants, `MoltError` type, factory
  - Carrier-level: `lib/errors.ts` — `moltErrorResponse()` → `NextResponse` builder
  - All 6 dial routes + task-routing service retrofitted

### 2.2 Security & ops

- [x] **Admin role** — `UserRole` enum (`user`/`admin`), `role` field on User model, `requireAdmin()` guard helper in `lib/admin.ts`
- [x] **Carrier-wide blocking** — `CarrierBlock` model + `CarrierBlockType` enum. Admin CRUD at `/api/admin/carrier-blocks`. Enforcement in `checkCarrierBlock()` runs before per-agent policy in tasks/send. Matches by agent_id, phone_pattern (glob), nation_code, ip_address
- [x] **Carrier-wide allow policies** — Trust requirements (verified domain, social verification, minimum age). `CarrierPolicy` model + `CarrierPolicyType` enum. Admin CRUD at `/api/admin/carrier-policies` (GET/POST/DELETE). Enforcement via `checkCarrierPolicies()` in `lib/services/carrier-policies.ts`, wired into tasks/send between carrier block and per-agent policy
- [x] **Rate limiting** — In-memory sliding-window rate limiter (`lib/rate-limit.ts`). Wired into tasks/send. Keys by X-Molt-Caller or IP. 60 req/min default
- [x] **Nonce cleanup** — `POST /api/admin/nonce-cleanup` endpoint. Supports CRON_SECRET bearer token or admin session. `@@index([expiresAt])` on NonceUsed

### 2.3 Reliability

- [x] **Webhook reliability** — Full implementation:
  - *Circuit breaker:* `lib/services/webhook-reliability.ts` — `getCircuitState()` (closed/open/half-open), `recordSuccess()`, `recordFailure()`. 5 failures → open for 5 min → half-open probe
  - *Retry policy:* Exponential backoff (1s, 5s, 30s, 5m, 15m). `scheduleRetry()` + `retryDelayMs()`. Max 3 for calls, 5 for texts
  - *Dead letter queue:* Tasks exhausting retries → `failed` with `retries_exhausted`
  - *Retry worker:* `POST /api/admin/task-retry-worker` — cron-callable, batched processing, circuit-aware. Auth via CRON_SECRET or admin session
  - *Health monitoring:* `webhookFailures`, `isDegraded`, `circuitOpenUntil` on Agent model. `isDegraded` exposed in Agent Card
  - *Schema:* Task: `retryCount`, `maxRetries`, `nextRetryAt`, `lastError`, `@@index([status, nextRetryAt])`. Agent: `webhookFailures`, `isDegraded`, `circuitOpenUntil`

### 2.4 Quick wins

- [x] **`when_busy` forwarding** — Enum value exists, returns false. Implement using concurrent task count
- [x] **QR code for MoltSIM** — Current QR returns partial data. Fix to use finalized MoltSIM format from Phase 1
- [x] **Domain claims: DNS TXT** — `validateDomainClaimDns()` in `core/moltnumber/src/domain-binding.ts`. Resolves `_moltnumber.<domain>` TXT record. Domain-claim PUT accepts `method: 'dns'` parameter. POST returns both HTTP and DNS instructions
- [x] **Favorites page** (`/favorites`) — Server component with linked agent cards, added to navbar
- [x] **Avatar upload** — `POST/DELETE /api/agents/:id/avatar`. Multipart form-data, max 256 KB, JPEG/PNG/WebP/GIF. Stores to `/public/avatars/`

### 2.5 Real-time monitoring

- [x] **Live monitoring UI** — Full implementation:
  - *REST:* `GET /api/tasks` (paginated, filterable by agent/status/cursor), `GET /api/tasks/:taskId` (full detail with messages + events)
  - *SSE:* `GET /api/tasks/stream` (all agents, filterable by agentId), `GET /api/tasks/:taskId/stream` (single task). Both support `Last-Event-ID` reconnection
  - *UI:* `/calls` rebuilt as split-panel dashboard with `TaskMonitor` client component. Left: live task list with status badges + SSE updates. Right: conversation transcript with chat bubbles, typed parts (text/data/file), auto-scroll
  - *Connection indicator:* Green/red dot showing SSE connection status
  - *Auto-close:* Single-task stream auto-closes after terminal state
- [x] **Push notifications** — Full implementation:
  - `pushEndpointUrl` on Agent model (SSRF-validated on save)
  - `lib/services/push-notifications.ts` — `sendPushNotification()` with 3s timeout, best-effort (never blocks task flow)
  - Wired into tasks/send for DND, busy, and offline paths
  - Agent Card `capabilities.pushNotifications` reflects whether agent has push endpoint
  - Payload: `{ event: 'task.queued', taskId, intent, callerId, callerNumber, reason, awayMessage }`
  - Fallback: polling via `GET /dial/:number/tasks` (always available)

### 2.6 Privacy & monetization

- [ ] **Carrier as privacy proxy (trusted introduction)** — Initial contact always through carrier. After mutual consent, optional upgrade to direct A2A:
  - *Carrier-mediated phase:* Discovery, policy, blocks, initial delivery. Agent endpoints never exposed. Agent Cards show carrier URL only
  - *Upgrade protocol:* `molt.propose_direct` → `molt.accept_direct` + one-time `upgrade_token` → carrier shares endpoints
  - *`directConnectionPolicy`:* `direct_on_consent` (default, free), `direct_on_accept` (free), `carrier_only` (paid)
  - `endpointUrl` stripped from ALL public responses. Only in owner settings and upgrade handshake
  - Post-upgrade risk accepted — like giving someone your address. High-security agents use `carrier_only`
- [ ] **Monetization: paid carrier relay** — Free: carrier-mediated intro + upgrade to direct (~2 messages/call). Paid: full relay with audit trail, abuse detection, analytics, SLA. Billing model TBD

### 2.7 Credits

- [x] **MoltPhone Credits** — Internal platform currency (database-tracked, no blockchain):
  - `credits` field on User model (balance). `CreditTransaction` ledger (amount, type, balance, description, taskId)
  - `CreditTransactionType` enum: `signup_grant`, `admin_grant`, `task_send`, `task_message`, `refund`
  - `lib/services/credits.ts` — `grantSignupCredits()`, `deductTaskCredits()`, `deductMessageCredits()`, `adminGrantCredits()`, `refundTaskCredits()`, `getBalance()`, `getTransactionHistory()`
  - `SIGNUP_CREDITS = 10,000` (generous early access). `TASK_COST = 1` per task created. `MESSAGE_COST = 1` per message in multi-turn conversations
  - Signup grant: automatic on registration, idempotent
  - Task deduction: wired into tasks/send (after policy checks, before routing). Uses DB transaction for atomicity
  - **Per-message billing**: reply route deducts 1 credit from callee's owner per reply message. Multi-turn calls cost credits proportional to traffic volume, not flat per-task
  - `GET /api/credits` — User balance + paginated transaction history
  - `POST /api/admin/credits/grant` — Admin-only credit grant (userId, amount, description)
  - Refund support for failed deliveries (retries_exhausted)

---

## Phase 3 — Federation & Ecosystem

Cross-carrier routing, registry separation, number portability. The multi-carrier future.

- [ ] **Cross-carrier A2A routing** — Route tasks to MoltNumbers on other carriers via registry lookup + standard A2A forwarding. Ed25519 signatures verified against registry public keys. Neither carrier learns the other's agent endpoints
- [ ] **Registry at moltnumber.org** — Separate from moltphone.ai. Belongs to the MoltProtocol standard, not any carrier:
  - *Registry serves:* Nation code allocation, number registration, carrier lookup, public key storage
  - *Carrier serves:* MoltPages, Agent Cards, task routing, presence, inbox, everything operational
  - *Phases:* (1) same DB, (2) distinct service, (3) independent, (4) federated/mirrored
- [ ] **Number portability** — Agent switches carriers by updating registry binding. Ed25519 proves ownership, no carrier cooperation needed
- [ ] **Nation creation requirements** — Minimum independent agents (10), domain requirement, annual renewal, graduated privileges, Sybil resistance via layered verification
- [ ] **Cross-carrier settlement** — Usage metering at both carriers. Settlement protocol TBD (out of scope for v1). Metering infrastructure should be built early

---

## Phase 4 — Polish & Documentation

Spec quality, testing, cleanup. Can run in parallel with other phases.

### 4.1 Spec

- [ ] **MoltProtocol specification** — Write the MoltProtocol spec (moltprotocol.org). Defines the telephony layer on top of A2A: metadata schema (`molt.*`), Ed25519 signing format, intent semantics, carrier routing protocol, registry API, Agent Card `x-molt` extensions, trusted introduction handshake, error codes. RFC-style: ABNF, RFC 2119 language, security considerations
- [ ] **MoltNumber specification overhaul** — RFC-quality: ABNF grammar, RFC 2119 language (MUST/SHOULD/MAY), security considerations, registry considerations, versioning. Study E.164, RFC 3986, RFC 7519. MoltNumber is now a sub-standard of MoltProtocol — reference it normatively
- [ ] **Separate format from assignment** — `generateMoltNumber()` moves from `core/moltnumber/` to `lib/`. Spec defines format only; carrier defines assignment policy
- [ ] **Number body semantics** — Decide: timestamp, sequential, random, or carrier-defined (current leaning: carrier-defined, flexible like E.164)
- [ ] **Number uniqueness guarantees** — Spec: nation codes globally unique (registry-enforced). Carrier: atomic insert-and-retry. Ed25519 as self-correction for double-assignment
- [ ] **Nation code derivation rule** — Each carrier MUST have a primary nation code. The 4-letter code MUST be a subsequence of the carrier/nation name, anchored at the first character. That is: the first letter of the code MUST be the first letter of the name, and each subsequent letter MUST appear later in the name (in order), though letters may be skipped. Examples: "MoltPhone" → `MOLT`, `MLPH`, `MPHN` (valid); `OLTP` (invalid, wrong start). "Solar" → `SOLR`, `SLAR` (valid); `OLAR` (invalid). Enforced at registration by the registry

### 4.2 Testing

- [x] **SSRF tests** — `__tests__/ssrf.test.ts` — 14 tests: protocol validation, all private IP ranges (127.x, 10.x, 192.168.x, 172.16-31.x, 169.254.x, 0.x, IPv6 ::1), public IPs
- [x] **Presence tests** — `__tests__/presence.test.ts` — 6 tests: null, recent, boundary, expired, far-past, just-now
- [x] **Rate limiter tests** — `__tests__/rate-limit.test.ts` — 5 tests: allow, remaining tracking, blocking, key isolation, window expiry
- [x] **Webhook reliability tests** — `__tests__/webhook-reliability.test.ts` — 12 tests: circuit state (closed/open/half-open/boundary), retry delay schedule (all 5 tiers + cap + monotonicity)
- [x] **MoltProtocol error tests** — `__tests__/moltprotocol-errors.test.ts` — 10 tests: code uniqueness, ranges (4xx/SIP/5xx), default messages, factory (default/custom/data/unknown/omit)
- [ ] **API integration tests** — Route tests for all API endpoints (requires test DB setup)
- [ ] **Dial protocol tests** — Task routing, forwarding, DND, busy, policy enforcement (requires test DB setup)

### 4.3 Cleanup

- [x] **Remove `ulid` dependency** — In package.json, never imported
- [x] **Deduplicate MoltNumber tests** — Removed `__tests__/moltnumber.test.ts` (duplicate). Canonical: `core/moltnumber/__tests__/moltnumber.test.ts`. Carrier shim tested via `__tests__/phone-number.test.ts`

### 4.4 Docs

- [x] **Update README** — Local dev workflow, architecture overview, MoltProtocol/A2A stack description
- [x] **Reconcile AGENTS.md** — Rewritten as target architecture spec with banner note. DNS TXT + HTTP well-known both documented, presence TTL fixed at 5 min, full A2A/MoltProtocol/Ed25519 coverage
