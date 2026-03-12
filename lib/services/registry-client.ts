/**
 * Registry HTTP Client — Calls a remote MoltNumber Registry over HTTP.
 *
 * Used when REGISTRY_MODE=remote. The client mirrors every function in the
 * local registry service (lib/services/registry.ts) but delegates to a
 * remote registry at REGISTRY_URL instead of hitting Prisma directly.
 *
 * Authentication: Carrier Ed25519 signature on write operations.
 * Read operations (lookup, list) are public — no auth required.
 */

import crypto from 'node:crypto';
import { REGISTRY_URL } from '@/carrier.config';
import {
  type RegisterCarrierInput,
  type BindNumberInput,
  type BindNationInput,
} from './registry';

// ── Helpers ──────────────────────────────────────────────

const TIMEOUT_MS = 10_000;

async function registryFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${REGISTRY_URL}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function carrierAuthHeaders(): Record<string, string> {
  const domain = process.env.CARRIER_DOMAIN || 'moltphone.ai';
  const privateKey = process.env.CARRIER_PRIVATE_KEY;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');

  if (!privateKey) {
    // In dev without a carrier key, send domain-only header (registry can
    // accept this in development mode)
    return { 'X-Registry-Carrier': domain };
  }

  // Sign: "REGISTRY\n{domain}\n{timestamp}\n{nonce}"
  // The registry verifies this using the carrier's registered public key.
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKey, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  const canonical = `REGISTRY\n${domain}\n${timestamp}\n${nonce}`;
  const signature = crypto.sign(null, Buffer.from(canonical), key).toString('base64url');

  return {
    'X-Registry-Carrier': domain,
    'X-Registry-Timestamp': timestamp,
    'X-Registry-Nonce': nonce,
    'X-Registry-Signature': signature,
  };
}

// ── Read Operations (public, no auth) ────────────────────

export async function remoteListCarriers() {
  const res = await registryFetch('/api/registry/carriers');
  if (!res.ok) throw new Error(`Registry listCarriers failed: ${res.status}`);
  const data = await res.json();
  return data.carriers;
}

export async function remoteGetCarrier(domain: string) {
  const res = await registryFetch(`/api/registry/carriers?domain=${encodeURIComponent(domain)}`);
  if (!res.ok) throw new Error(`Registry getCarrier failed: ${res.status}`);
  const data = await res.json();
  return data.carrier ?? null;
}

export async function remoteLookupNumber(moltNumber: string) {
  const res = await registryFetch(`/api/registry/lookup/${encodeURIComponent(moltNumber)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Registry lookupNumber failed: ${res.status}`);
  const data = await res.json();
  return data;
}

export async function remoteGetNationCarriers(nationCode: string) {
  const res = await registryFetch(`/api/registry/nations?nationCode=${encodeURIComponent(nationCode)}`);
  if (!res.ok) throw new Error(`Registry getNationCarriers failed: ${res.status}`);
  const data = await res.json();
  return data.carriers ?? data.bindings ?? data.nations ?? [];
}

// ── Write Operations (carrier-authenticated) ─────────────

export async function remoteRegisterCarrier(input: RegisterCarrierInput) {
  const res = await registryFetch('/api/registry/carriers', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: carrierAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registry registerCarrier failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.carrier;
}

export async function remoteBindNumber(input: BindNumberInput) {
  const res = await registryFetch('/api/registry/bind', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: carrierAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registry bindNumber failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.binding;
}

export async function remoteUnbindNumber(moltNumber: string) {
  const res = await registryFetch('/api/registry/bind', {
    method: 'DELETE',
    body: JSON.stringify({ moltNumber }),
    headers: carrierAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registry unbindNumber failed: ${res.status} ${body}`);
  }
  return { count: 1 };
}

export async function remoteBindNation(input: BindNationInput) {
  const res = await registryFetch('/api/registry/nations', {
    method: 'POST',
    body: JSON.stringify(input),
    headers: carrierAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registry bindNation failed: ${res.status} ${body}`);
  }
  const data = await res.json();
  return data.binding;
}

export async function remoteSelfRegister() {
  const domain = process.env.CARRIER_DOMAIN || 'moltphone.ai';
  const publicKey = process.env.CARRIER_PUBLIC_KEY || 'dev-public-key';
  const callBaseUrl = (process.env.CALL_BASE_URL || 'http://localhost:3000/call');
  const name = process.env.CARRIER_NAME || 'MoltPhone';

  const res = await registryFetch('/api/registry/self-register', {
    method: 'POST',
    body: JSON.stringify({ domain, publicKey, callBaseUrl, name }),
    headers: carrierAuthHeaders(),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Registry selfRegister failed: ${res.status} ${body}`);
  }
  return res.json();
}
