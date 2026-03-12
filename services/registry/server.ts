/**
 * MoltNumber Registry — Standalone Server (Phase 2)
 *
 * A lightweight, independent registry service that maps MoltNumbers to
 * carrier endpoints. Designed to run as a separate process from the carrier,
 * sharing the same PostgreSQL database (Phase 2) or its own database (Phase 3).
 *
 * Security:
 *   - Ed25519 carrier auth with nonce replay protection on all writes
 *   - Per-carrier rate limiting (sliding window)
 *   - Audit log for all mutations
 *   - Admin endpoints to suspend/revoke carriers
 *   - Stale binding cleanup via heartbeat tracking
 *
 * Run:
 *   npx tsx services/registry/server.ts
 *
 * Environment:
 *   DATABASE_URL          — PostgreSQL connection string (required)
 *   REGISTRY_PORT / PORT  — Listen port (default: 3001)
 *   REGISTRY_ADMIN_KEY    — Admin API key for management (required in production)
 *   NODE_ENV              — 'production' for strict mode
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { PrismaClient, RegistryCarrierStatus } from '@prisma/client';

const prisma = new PrismaClient();
const PORT = Number(process.env.REGISTRY_PORT || process.env.PORT || 3001);
const ADMIN_KEY = process.env.REGISTRY_ADMIN_KEY || '';
const TIMESTAMP_WINDOW = 300; // ±5 minutes
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes (2× timestamp window)
const STALE_CARRIER_DAYS = Number(process.env.STALE_CARRIER_DAYS) || 30;

// ── Helpers ──────────────────────────────────────────────

type Res = http.ServerResponse;

function json(res: Res, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function getClientIp(req: http.IncomingMessage): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString();
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

// ── Nonce Replay Protection ──────────────────────────────

/** In-memory nonce store with TTL-based expiry. */
const usedNonces = new Map<string, number>(); // nonce → expiresAt (ms)

function isNonceReplay(nonce: string): boolean {
  const now = Date.now();
  const existing = usedNonces.get(nonce);
  if (existing && existing > now) return true; // Replay!
  usedNonces.set(nonce, now + NONCE_TTL_MS);
  return false;
}

/** Periodic cleanup of expired nonces (runs every 5 minutes). */
function cleanupNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) usedNonces.delete(nonce);
  }
}
setInterval(cleanupNonces, 5 * 60 * 1000).unref();

// ── Rate Limiting ────────────────────────────────────────

/** Sliding window rate limiter. Per carrier, per minute. */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_WRITES = Number(process.env.REGISTRY_RATE_LIMIT) || 120;

const rateLimitBuckets = new Map<string, number[]>(); // domain → timestamp[]

function checkRateLimit(domain: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  let timestamps = rateLimitBuckets.get(domain);
  if (!timestamps) {
    timestamps = [];
    rateLimitBuckets.set(domain, timestamps);
  }
  // Prune old entries
  while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
  if (timestamps.length >= RATE_LIMIT_MAX_WRITES) return false; // Over limit
  timestamps.push(now);
  return true;
}

/** Periodic cleanup of stale rate limit buckets (runs every 5 minutes). */
function cleanupRateLimits() {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  for (const [domain, timestamps] of rateLimitBuckets) {
    while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
    if (timestamps.length === 0) rateLimitBuckets.delete(domain);
  }
}
setInterval(cleanupRateLimits, 5 * 60 * 1000).unref();

// ── Audit Log ────────────────────────────────────────────

interface AuditEntry {
  action: string;
  target: string;
  carrierDomain?: string;
  detail?: string;
  ip: string;
  timestamp: Date;
}

/**
 * Write an audit entry to both in-memory ring buffer and database.
 * DB write is fire-and-forget — never blocks request processing.
 */
async function audit(entry: AuditEntry, carrierId?: string) {
  // Write to DB (fire-and-forget)
  prisma.registryAuditLog.create({
    data: {
      carrierId: carrierId ?? null,
      action: entry.action,
      target: entry.target,
      detail: entry.detail ?? null,
      ip: entry.ip,
    },
  }).catch((e: unknown) => {
    console.error('[registry] Audit log write failed:', e);
  });
}

// ── Carrier Ed25519 Auth ─────────────────────────────────

interface AuthResult {
  ok: boolean;
  domain?: string;
  reason?: string;
}

/**
 * Verify carrier authentication via Ed25519 signature.
 *
 * Canonical string: "REGISTRY\n{domain}\n{timestamp}\n{nonce}"
 * Headers: X-Registry-Carrier, X-Registry-Timestamp, X-Registry-Nonce, X-Registry-Signature
 *
 * For new carrier registration, pass publicKeyOverride (from request body)
 * since the carrier isn't in the DB yet.
 */
async function verifyCarrierAuth(
  headers: http.IncomingHttpHeaders,
  publicKeyOverride?: string,
): Promise<AuthResult> {
  const carrier = headers['x-registry-carrier'] as string | undefined;
  const timestamp = headers['x-registry-timestamp'] as string | undefined;
  const nonce = headers['x-registry-nonce'] as string | undefined;
  const signature = headers['x-registry-signature'] as string | undefined;

  if (!carrier) {
    return { ok: false, reason: 'Missing X-Registry-Carrier header' };
  }

  // Development mode: accept unsigned requests when no admin key is set
  if (!IS_PRODUCTION && !ADMIN_KEY && !signature) {
    console.warn(`[registry] Dev mode: accepting unsigned request from ${carrier}`);
    return { ok: true, domain: carrier };
  }

  if (!timestamp || !signature) {
    return { ok: false, reason: 'Missing X-Registry-Timestamp or X-Registry-Signature' };
  }

  // Timestamp window check (±5 minutes)
  const ts = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (isNaN(ts) || Math.abs(now - ts) > TIMESTAMP_WINDOW) {
    return { ok: false, reason: 'Timestamp out of window' };
  }

  // Nonce replay check (nonce is optional for backward compat, but strongly recommended)
  if (nonce) {
    if (isNonceReplay(nonce)) {
      return { ok: false, reason: 'Nonce already used (replay detected)' };
    }
  } else if (IS_PRODUCTION) {
    return { ok: false, reason: 'Missing X-Registry-Nonce (required in production)' };
  }

  // Resolve public key: override (new carrier) or DB lookup (existing)
  let publicKey = publicKeyOverride;
  if (!publicKey) {
    const record = await prisma.registryCarrier.findUnique({
      where: { domain: carrier },
      select: { publicKey: true, status: true },
    });
    if (!record) return { ok: false, reason: `Carrier not registered: ${carrier}` };
    if (record.status !== 'active') return { ok: false, reason: 'Carrier suspended or revoked' };
    publicKey = record.publicKey;
  }

  // Verify Ed25519 signature
  // Canonical: "REGISTRY\n{domain}\n{timestamp}\n{nonce}" (nonce omitted if not provided)
  const canonicalParts = ['REGISTRY', carrier, timestamp];
  if (nonce) canonicalParts.push(nonce);
  const canonical = canonicalParts.join('\n');

  try {
    const pubKeyObj = crypto.createPublicKey({
      key: Buffer.from(publicKey, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    const sigBuf = Buffer.from(signature, 'base64url');
    const valid = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      pubKeyObj,
      sigBuf,
    );
    if (!valid) return { ok: false, reason: 'Signature mismatch' };
  } catch (e) {
    return {
      ok: false,
      reason: `Signature verification error: ${e instanceof Error ? e.message : 'unknown'}`,
    };
  }

  return { ok: true, domain: carrier };
}

/** Verify admin API key from Authorization header (Bearer <key>). */
function requireAdmin(headers: http.IncomingHttpHeaders): AuthResult {
  if (!ADMIN_KEY) {
    // In dev, allow if no key is configured
    if (!IS_PRODUCTION) return { ok: true, domain: 'admin' };
    return { ok: false, reason: 'No REGISTRY_ADMIN_KEY configured' };
  }
  const auth = headers['authorization'] as string | undefined;
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, reason: 'Missing Authorization: Bearer <key> header' };
  }
  if (auth.slice(7) !== ADMIN_KEY) {
    return { ok: false, reason: 'Invalid admin key' };
  }
  return { ok: true, domain: 'admin' };
}

/** Update carrier heartbeat timestamp. Fire-and-forget. */
function touchCarrierHeartbeat(domain: string) {
  prisma.registryCarrier.update({
    where: { domain },
    data: { lastHeartbeatAt: new Date() },
  }).catch(() => { /* Swallow — best-effort */ });
}

// ── Route Handlers ───────────────────────────────────────

/** GET /api/registry/carriers — List carriers (optionally filter by ?domain=) */
async function handleListCarriers(res: Res, url: URL) {
  const domain = url.searchParams.get('domain');

  if (domain) {
    const carrier = await prisma.registryCarrier.findUnique({
      where: { domain },
    });
    return json(res, { carrier: carrier ?? null });
  }

  const carriers = await prisma.registryCarrier.findMany({
    where: { status: RegistryCarrierStatus.active },
    orderBy: { registeredAt: 'asc' },
  });
  return json(res, { carriers });
}

/** POST /api/registry/carriers — Register or update a carrier */
async function handleRegisterCarrier(req: http.IncomingMessage, res: Res) {
  const body = await parseBody(req);
  if (!body?.domain || !body?.publicKey || !body?.callBaseUrl) {
    return json(res, { error: 'Missing required fields: domain, publicKey, callBaseUrl' }, 400);
  }

  const domain = String(body.domain);
  const publicKey = String(body.publicKey);
  const callBaseUrl = String(body.callBaseUrl);
  const name = body.name ? String(body.name) : undefined;

  // For new carriers: verify signature against the key in the body.
  // For existing carriers: verify against the stored key.
  const existing = await prisma.registryCarrier.findUnique({
    where: { domain },
  });

  const auth = await verifyCarrierAuth(
    req.headers,
    existing ? undefined : publicKey,
  );
  if (!auth.ok) return json(res, { error: auth.reason }, 403);

  // Carrier can only register/update itself
  if (auth.domain !== domain) {
    return json(res, { error: 'Carrier domain mismatch — can only register itself' }, 403);
  }

  // Rate limit
  if (!checkRateLimit(domain)) {
    return json(res, { error: 'Rate limit exceeded' }, 429);
  }

  const carrier = await prisma.registryCarrier.upsert({
    where: { domain },
    create: { domain, publicKey, callBaseUrl, name, lastHeartbeatAt: new Date() },
    update: {
      publicKey,
      callBaseUrl,
      name,
      status: RegistryCarrierStatus.active,
      lastHeartbeatAt: new Date(),
    },
  });

  await audit({
    action: existing ? 'carrier.update' : 'carrier.register',
    target: domain,
    carrierDomain: domain,
    detail: JSON.stringify({ callBaseUrl, name }),
    ip: getClientIp(req),
    timestamp: new Date(),
  }, carrier.id);

  return json(res, { carrier }, 201);
}

/** GET /api/registry/lookup/:moltNumber — Resolve number → carrier */
async function handleLookupNumber(res: Res, moltNumber: string) {
  const binding = await prisma.registryNumberBinding.findUnique({
    where: { moltNumber },
    include: {
      carrier: {
        select: {
          domain: true,
          callBaseUrl: true,
          publicKey: true,
          status: true,
        },
      },
    },
  });

  if (!binding || binding.carrier.status !== RegistryCarrierStatus.active) {
    return json(res, { error: 'Number not found in registry' }, 404);
  }

  return json(res, {
    moltNumber: binding.moltNumber,
    nationCode: binding.nationCode,
    carrier: {
      domain: binding.carrier.domain,
      callBaseUrl: binding.carrier.callBaseUrl,
      publicKey: binding.carrier.publicKey,
    },
  });
}

/** POST /api/registry/bind — Bind a MoltNumber to a carrier */
async function handleBindNumber(req: http.IncomingMessage, res: Res) {
  const auth = await verifyCarrierAuth(req.headers);
  if (!auth.ok) return json(res, { error: auth.reason }, 403);

  if (!checkRateLimit(auth.domain!)) {
    return json(res, { error: 'Rate limit exceeded' }, 429);
  }

  const body = await parseBody(req);
  if (!body?.moltNumber || !body?.carrierDomain || !body?.nationCode) {
    return json(
      res,
      { error: 'Missing required fields: moltNumber, carrierDomain, nationCode' },
      400,
    );
  }

  const carrierDomain = String(body.carrierDomain);
  const moltNumber = String(body.moltNumber);
  const nationCode = String(body.nationCode);

  // Carrier can only bind numbers to itself
  if (auth.domain !== carrierDomain) {
    return json(res, { error: 'Carrier can only bind numbers to itself' }, 403);
  }

  const carrier = await prisma.registryCarrier.findUnique({
    where: { domain: carrierDomain, status: RegistryCarrierStatus.active },
  });
  if (!carrier) {
    return json(res, { error: `Carrier not found or inactive: ${carrierDomain}` }, 404);
  }

  const binding = await prisma.registryNumberBinding.upsert({
    where: { moltNumber },
    create: { moltNumber, carrierId: carrier.id, nationCode },
    update: { carrierId: carrier.id, nationCode },
    include: { carrier: true },
  });

  touchCarrierHeartbeat(carrierDomain);
  await audit({
    action: 'number.bind',
    target: moltNumber,
    carrierDomain,
    detail: JSON.stringify({ nationCode }),
    ip: getClientIp(req),
    timestamp: new Date(),
  }, carrier.id);

  return json(res, { binding }, 201);
}

/** DELETE /api/registry/bind — Unbind a MoltNumber */
async function handleUnbindNumber(req: http.IncomingMessage, res: Res) {
  const auth = await verifyCarrierAuth(req.headers);
  if (!auth.ok) return json(res, { error: auth.reason }, 403);

  if (!checkRateLimit(auth.domain!)) {
    return json(res, { error: 'Rate limit exceeded' }, 429);
  }

  const body = await parseBody(req);
  if (!body?.moltNumber) {
    return json(res, { error: 'Missing required field: moltNumber' }, 400);
  }

  const moltNumber = String(body.moltNumber);

  // Verify the number belongs to this carrier before unbinding
  const existing = await prisma.registryNumberBinding.findUnique({
    where: { moltNumber },
    include: { carrier: { select: { id: true, domain: true } } },
  });
  if (existing && existing.carrier.domain !== auth.domain) {
    return json(res, { error: 'Cannot unbind number belonging to another carrier' }, 403);
  }

  await prisma.registryNumberBinding.deleteMany({ where: { moltNumber } });

  touchCarrierHeartbeat(auth.domain!);
  await audit({
    action: 'number.unbind',
    target: moltNumber,
    carrierDomain: auth.domain,
    ip: getClientIp(req),
    timestamp: new Date(),
  }, existing?.carrier.id);

  return json(res, { ok: true });
}

/** GET /api/registry/nations — List nation → carrier bindings */
async function handleListNations(res: Res, url: URL) {
  const nationCode = url.searchParams.get('nationCode');

  if (nationCode) {
    const code = nationCode.toUpperCase();
    const bindings = await prisma.registryNationBinding.findMany({
      where: { nationCode: code },
      include: {
        carrier: {
          select: { domain: true, callBaseUrl: true, name: true, status: true },
        },
      },
      orderBy: { registeredAt: 'asc' },
    });
    return json(res, { nationCode: code, carriers: bindings });
  }

  const bindings = await prisma.registryNationBinding.findMany({
    include: {
      carrier: {
        select: { domain: true, callBaseUrl: true, name: true, status: true },
      },
    },
    orderBy: { nationCode: 'asc' },
  });

  const grouped: Record<string, typeof bindings> = {};
  for (const b of bindings) {
    (grouped[b.nationCode] ??= []).push(b);
  }

  return json(res, { nations: grouped });
}

/** POST /api/registry/nations — Bind a nation to a carrier */
async function handleBindNation(req: http.IncomingMessage, res: Res) {
  const auth = await verifyCarrierAuth(req.headers);
  if (!auth.ok) return json(res, { error: auth.reason }, 403);

  if (!checkRateLimit(auth.domain!)) {
    return json(res, { error: 'Rate limit exceeded' }, 429);
  }

  const body = await parseBody(req);
  if (!body?.nationCode || !body?.carrierDomain) {
    return json(
      res,
      { error: 'Missing required fields: nationCode, carrierDomain' },
      400,
    );
  }

  const carrierDomain = String(body.carrierDomain);
  const nationCode = String(body.nationCode);
  const isPrimary = body.isPrimary === true;

  // Carrier can only bind nations to itself
  if (auth.domain !== carrierDomain) {
    return json(res, { error: 'Carrier can only bind nations to itself' }, 403);
  }

  const carrier = await prisma.registryCarrier.findUnique({
    where: { domain: carrierDomain, status: RegistryCarrierStatus.active },
  });
  if (!carrier) {
    return json(res, { error: `Carrier not found or inactive: ${carrierDomain}` }, 404);
  }

  const binding = await prisma.registryNationBinding.upsert({
    where: {
      nationCode_carrierId: {
        nationCode,
        carrierId: carrier.id,
      },
    },
    create: { nationCode, carrierId: carrier.id, isPrimary },
    update: { isPrimary: isPrimary || undefined },
    include: { carrier: true },
  });

  touchCarrierHeartbeat(carrierDomain);
  await audit({
    action: 'nation.bind',
    target: nationCode,
    carrierDomain,
    detail: JSON.stringify({ isPrimary }),
    ip: getClientIp(req),
    timestamp: new Date(),
  }, carrier.id);

  return json(res, { binding }, 201);
}

/** POST /api/registry/self-register — Carrier bulk self-registration */
async function handleSelfRegister(req: http.IncomingMessage, res: Res) {
  const body = await parseBody(req);
  if (!body?.domain || !body?.publicKey || !body?.callBaseUrl) {
    return json(res, { error: 'Missing required fields: domain, publicKey, callBaseUrl' }, 400);
  }

  const domain = String(body.domain);
  const publicKey = String(body.publicKey);
  const callBaseUrl = String(body.callBaseUrl);
  const name = body.name ? String(body.name) : undefined;

  // Auth: new carriers verify against body key, existing against stored key
  const existing = await prisma.registryCarrier.findUnique({
    where: { domain },
  });
  const auth = await verifyCarrierAuth(
    req.headers,
    existing ? undefined : publicKey,
  );
  if (!auth.ok) return json(res, { error: auth.reason }, 403);
  if (auth.domain !== domain) {
    return json(res, { error: 'Carrier domain mismatch' }, 403);
  }

  if (!checkRateLimit(domain)) {
    return json(res, { error: 'Rate limit exceeded' }, 429);
  }

  // Register / update carrier
  const carrier = await prisma.registryCarrier.upsert({
    where: { domain },
    create: { domain, publicKey, callBaseUrl, name, lastHeartbeatAt: new Date() },
    update: {
      publicKey,
      callBaseUrl,
      name,
      status: RegistryCarrierStatus.active,
      lastHeartbeatAt: new Date(),
    },
  });

  // Optionally process bulk nations and numbers from request body
  let nationsRegistered = 0;
  let numbersRegistered = 0;

  if (Array.isArray(body.nations)) {
    for (const n of body.nations as Array<{ nationCode: string; isPrimary?: boolean }>) {
      if (!n?.nationCode) continue;
      await prisma.registryNationBinding.upsert({
        where: {
          nationCode_carrierId: {
            nationCode: n.nationCode,
            carrierId: carrier.id,
          },
        },
        create: {
          nationCode: n.nationCode,
          carrierId: carrier.id,
          isPrimary: n.isPrimary ?? false,
        },
        update: { isPrimary: n.isPrimary ?? undefined },
      });
      nationsRegistered++;
    }
  }

  if (Array.isArray(body.numbers)) {
    for (const num of body.numbers as Array<{ moltNumber: string; nationCode: string }>) {
      if (!num?.moltNumber || !num?.nationCode) continue;
      await prisma.registryNumberBinding.upsert({
        where: { moltNumber: num.moltNumber },
        create: {
          moltNumber: num.moltNumber,
          carrierId: carrier.id,
          nationCode: num.nationCode,
        },
        update: { carrierId: carrier.id, nationCode: num.nationCode },
      });
      numbersRegistered++;
    }
  }

  await audit({
    action: 'carrier.self-register',
    target: domain,
    carrierDomain: domain,
    detail: JSON.stringify({ nationsRegistered, numbersRegistered }),
    ip: getClientIp(req),
    timestamp: new Date(),
  }, carrier.id);

  return json(res, {
    ok: true,
    carrier: carrier.domain,
    nationsRegistered,
    numbersRegistered,
  });
}

// ── Admin Endpoints ──────────────────────────────────────

/**
 * PATCH /api/registry/admin/carriers/:domain — Suspend or revoke a carrier.
 * Requires REGISTRY_ADMIN_KEY.
 */
async function handleAdminCarrierAction(req: http.IncomingMessage, res: Res, domain: string) {
  const admin = requireAdmin(req.headers);
  if (!admin.ok) return json(res, { error: admin.reason }, 403);

  const body = await parseBody(req);
  const action = body?.action as string | undefined;

  if (!action || !['suspend', 'revoke', 'activate'].includes(action)) {
    return json(res, { error: 'action must be "suspend", "revoke", or "activate"' }, 400);
  }

  const carrier = await prisma.registryCarrier.findUnique({ where: { domain } });
  if (!carrier) return json(res, { error: `Carrier not found: ${domain}` }, 404);

  const statusMap: Record<string, RegistryCarrierStatus> = {
    suspend: RegistryCarrierStatus.suspended,
    revoke: RegistryCarrierStatus.revoked,
    activate: RegistryCarrierStatus.active,
  };

  const updated = await prisma.registryCarrier.update({
    where: { domain },
    data: { status: statusMap[action] },
  });

  await audit({
    action: `carrier.${action}`,
    target: domain,
    detail: JSON.stringify({
      previousStatus: carrier.status,
      newStatus: statusMap[action],
      reason: body?.reason ?? null,
    }),
    ip: getClientIp(req),
    timestamp: new Date(),
  }, carrier.id);

  return json(res, { carrier: updated });
}

/**
 * GET /api/registry/admin/audit — Query audit log.
 * Requires REGISTRY_ADMIN_KEY.
 */
async function handleAdminAudit(req: http.IncomingMessage, res: Res, url: URL) {
  const admin = requireAdmin(req.headers);
  if (!admin.ok) return json(res, { error: admin.reason }, 403);

  const action = url.searchParams.get('action');
  const target = url.searchParams.get('target');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (target) where.target = { contains: target };

  const logs = await prisma.registryAuditLog.findMany({
    where,
    orderBy: { timestamp: 'desc' },
    take: limit,
    include: {
      carrier: { select: { domain: true } },
    },
  });

  return json(res, { logs, count: logs.length });
}

/**
 * POST /api/registry/admin/cleanup-stale — Remove bindings for stale carriers.
 * A carrier is "stale" if lastHeartbeatAt is older than STALE_CARRIER_DAYS
 * (default: 30 days) and it hasn't been seen since.
 * Requires REGISTRY_ADMIN_KEY.
 */
async function handleAdminCleanupStale(req: http.IncomingMessage, res: Res) {
  const admin = requireAdmin(req.headers);
  if (!admin.ok) return json(res, { error: admin.reason }, 403);

  const cutoff = new Date(Date.now() - STALE_CARRIER_DAYS * 24 * 60 * 60 * 1000);

  const staleCarriers = await prisma.registryCarrier.findMany({
    where: {
      status: RegistryCarrierStatus.active,
      OR: [
        { lastHeartbeatAt: null, registeredAt: { lt: cutoff } },
        { lastHeartbeatAt: { lt: cutoff } },
      ],
    },
    select: { id: true, domain: true, lastHeartbeatAt: true, registeredAt: true },
  });

  let numbersRemoved = 0;
  let nationsRemoved = 0;

  for (const carrier of staleCarriers) {
    const nums = await prisma.registryNumberBinding.deleteMany({
      where: { carrierId: carrier.id },
    });
    const nats = await prisma.registryNationBinding.deleteMany({
      where: { carrierId: carrier.id },
    });
    numbersRemoved += nums.count;
    nationsRemoved += nats.count;

    // Suspend (not delete) the carrier itself
    await prisma.registryCarrier.update({
      where: { id: carrier.id },
      data: { status: RegistryCarrierStatus.suspended },
    });

    await audit({
      action: 'carrier.stale-cleanup',
      target: carrier.domain,
      detail: JSON.stringify({
        lastHeartbeatAt: carrier.lastHeartbeatAt,
        registeredAt: carrier.registeredAt,
        numbersRemoved: nums.count,
        nationsRemoved: nats.count,
      }),
      ip: getClientIp(req),
      timestamp: new Date(),
    }, carrier.id);
  }

  return json(res, {
    ok: true,
    staleCarriers: staleCarriers.length,
    numbersRemoved,
    nationsRemoved,
    cutoffDate: cutoff.toISOString(),
  });
}

// ── Router ───────────────────────────────────────────────

async function handleRequest(req: http.IncomingMessage, res: Res) {
  const url = new URL(req.url!, 'http://localhost');
  const method = req.method!;
  const path = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Registry-Carrier, X-Registry-Timestamp, X-Registry-Nonce, X-Registry-Signature',
  );
  if (method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  try {
    // ── Health ────────────────────────────────────────────
    if (method === 'GET' && path === '/health') {
      return json(res, { ok: true, service: 'moltnumber-registry' });
    }

    // ── Carriers ─────────────────────────────────────────
    if (path === '/api/registry/carriers') {
      if (method === 'GET') return handleListCarriers(res, url);
      if (method === 'POST') return handleRegisterCarrier(req, res);
    }

    // ── Number Lookup ────────────────────────────────────
    const lookupMatch = path.match(/^\/api\/registry\/lookup\/(.+)$/);
    if (method === 'GET' && lookupMatch) {
      return handleLookupNumber(res, decodeURIComponent(lookupMatch[1]));
    }

    // ── Number Binding ───────────────────────────────────
    if (path === '/api/registry/bind') {
      if (method === 'POST') return handleBindNumber(req, res);
      if (method === 'DELETE') return handleUnbindNumber(req, res);
    }

    // ── Nations ──────────────────────────────────────────
    if (path === '/api/registry/nations') {
      if (method === 'GET') return handleListNations(res, url);
      if (method === 'POST') return handleBindNation(req, res);
    }

    // ── Self-Register ────────────────────────────────────
    if (method === 'POST' && path === '/api/registry/self-register') {
      return handleSelfRegister(req, res);
    }

    // ── Admin: Carrier Actions ───────────────────────────
    const adminCarrierMatch = path.match(/^\/api\/registry\/admin\/carriers\/([^/]+)$/);
    if (method === 'PATCH' && adminCarrierMatch) {
      return handleAdminCarrierAction(req, res, decodeURIComponent(adminCarrierMatch[1]));
    }

    // ── Admin: Audit Log ─────────────────────────────────
    if (method === 'GET' && path === '/api/registry/admin/audit') {
      return handleAdminAudit(req, res, url);
    }

    // ── Admin: Stale Cleanup ─────────────────────────────
    if (method === 'POST' && path === '/api/registry/admin/cleanup-stale') {
      return handleAdminCleanupStale(req, res);
    }

    // ── 404 ──────────────────────────────────────────────
    return json(res, { error: 'Not found' }, 404);
  } catch (e) {
    console.error('[registry] Unhandled error:', e);
    return json(res, { error: 'Internal server error' }, 500);
  }
}

// ── Start Server ─────────────────────────────────────────

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n  MoltNumber Registry — Phase 2 (standalone, shared DB)`);
  console.log(`  Listening on port ${PORT}\n`);
  console.log(`  Public endpoints:`);
  console.log(`    GET  /api/registry/carriers            — List carriers`);
  console.log(`    GET  /api/registry/lookup/:moltNumber  — Resolve number → carrier`);
  console.log(`    GET  /api/registry/nations             — List nation bindings`);
  console.log(`    GET  /health                           — Health check`);
  console.log(`\n  Authenticated endpoints (carrier Ed25519):`);
  console.log(`    POST /api/registry/carriers            — Register carrier`);
  console.log(`    POST /api/registry/bind                — Bind number`);
  console.log(`    DEL  /api/registry/bind                — Unbind number`);
  console.log(`    POST /api/registry/nations             — Bind nation`);
  console.log(`    POST /api/registry/self-register       — Bulk self-register`);
  console.log(`\n  Admin endpoints (REGISTRY_ADMIN_KEY):`);
  console.log(`    PATCH /api/registry/admin/carriers/:d  — Suspend / revoke / activate`);
  console.log(`    GET   /api/registry/admin/audit        — Query audit log`);
  console.log(`    POST  /api/registry/admin/cleanup-stale — Purge stale carrier bindings`);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n[registry] Shutting down...');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});
