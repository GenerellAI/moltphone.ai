/**
 * Registry Service — MoltNumber Registry (dual-mode)
 *
 * This module provides the logical interface for the MoltNumber registry.
 * It operates in two modes controlled by REGISTRY_MODE:
 *
 *   - **local** (default) — Prisma queries against the carrier's own database.
 *     Phase 1.5 architecture. Same DB, separate logic.
 *
 *   - **remote** — HTTP calls to an independent registry service at REGISTRY_URL
 *     (default: https://registry.moltprotocol.org). Write operations are
 *     authenticated with the carrier's Ed25519 key.
 *
 * The registry does two things:
 * 1. Carrier lookup — given a MoltNumber, which carrier routes for it?
 * 2. Nation code allocation — which carriers are authorized for which nations?
 *
 * Self-certifying numbers mean the registry never stores public keys for agents.
 * The key is verifiable from the number itself.
 */

import { prisma } from '@/lib/prisma';
import { RegistryCarrierStatus } from '@prisma/client';
import { REGISTRY_MODE } from '@/carrier.config';
import {
  remoteRegisterCarrier,
  remoteGetCarrier,
  remoteListCarriers,
  remoteBindNumber,
  remoteUnbindNumber,
  remoteLookupNumber,
  remoteBindNation,
  remoteGetNationCarriers,
} from './registry-client';

const isRemote = () => REGISTRY_MODE === 'remote';

// ── Carrier Registration ─────────────────────────────────

export interface RegisterCarrierInput {
  domain: string;
  publicKey: string;
  callBaseUrl: string;
  name?: string;
}

/**
 * Register a carrier with the registry. Idempotent — if the carrier already
 * exists (by domain), it updates the record.
 */
export async function registerCarrier(input: RegisterCarrierInput) {
  if (isRemote()) return remoteRegisterCarrier(input);
  return prisma.registryCarrier.upsert({
    where: { domain: input.domain },
    create: {
      domain: input.domain,
      publicKey: input.publicKey,
      callBaseUrl: input.callBaseUrl,
      name: input.name,
    },
    update: {
      publicKey: input.publicKey,
      callBaseUrl: input.callBaseUrl,
      name: input.name,
      status: RegistryCarrierStatus.active,
    },
  });
}

/**
 * Get a carrier by domain.
 */
export async function getCarrier(domain: string) {
  if (isRemote()) return remoteGetCarrier(domain);
  return prisma.registryCarrier.findUnique({ where: { domain } });
}

/**
 * List all active carriers.
 */
export async function listCarriers() {
  if (isRemote()) return remoteListCarriers();
  return prisma.registryCarrier.findMany({
    where: { status: RegistryCarrierStatus.active },
    orderBy: { registeredAt: 'asc' },
  });
}

// ── Number Binding (MoltNumber → Carrier) ────────────────

export interface BindNumberInput {
  moltNumber: string;
  carrierDomain: string;
  nationCode: string;
}

/**
 * Bind a MoltNumber to a carrier. Called when an agent is created.
 * Idempotent — rebinding the same number to the same carrier is a no-op.
 */
export async function bindNumber(input: BindNumberInput) {
  if (isRemote()) return remoteBindNumber(input);
  const carrier = await prisma.registryCarrier.findUnique({
    where: { domain: input.carrierDomain, status: RegistryCarrierStatus.active },
  });
  if (!carrier) throw new Error(`Carrier not found or inactive: ${input.carrierDomain}`);

  return prisma.registryNumberBinding.upsert({
    where: { moltNumber: input.moltNumber },
    create: {
      moltNumber: input.moltNumber,
      carrierId: carrier.id,
      nationCode: input.nationCode,
    },
    update: {
      carrierId: carrier.id,
      nationCode: input.nationCode,
    },
    include: { carrier: true },
  });
}

/**
 * Unbind a MoltNumber (agent deactivated/deleted).
 */
export async function unbindNumber(moltNumber: string) {
  if (isRemote()) return remoteUnbindNumber(moltNumber);
  return prisma.registryNumberBinding.deleteMany({
    where: { moltNumber },
  });
}

/**
 * Look up which carrier routes for a MoltNumber.
 * Returns null if the number is not registered.
 */
export async function lookupNumber(moltNumber: string) {
  if (isRemote()) return remoteLookupNumber(moltNumber);
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

  if (!binding) return null;
  if (binding.carrier.status !== RegistryCarrierStatus.active) return null;

  return {
    moltNumber: binding.moltNumber,
    nationCode: binding.nationCode,
    carrier: {
      domain: binding.carrier.domain,
      callBaseUrl: binding.carrier.callBaseUrl,
      publicKey: binding.carrier.publicKey,
    },
  };
}

// ── Nation Binding (Nation → Carrier authorization) ───────

export interface BindNationInput {
  nationCode: string;
  carrierDomain: string;
  isPrimary?: boolean;
}

/**
 * Bind a nation to a carrier (authorize the carrier to issue numbers under this nation).
 */
export async function bindNation(input: BindNationInput) {
  if (isRemote()) return remoteBindNation(input);
  const carrier = await prisma.registryCarrier.findUnique({
    where: { domain: input.carrierDomain, status: RegistryCarrierStatus.active },
  });
  if (!carrier) throw new Error(`Carrier not found or inactive: ${input.carrierDomain}`);

  return prisma.registryNationBinding.upsert({
    where: {
      nationCode_carrierId: {
        nationCode: input.nationCode,
        carrierId: carrier.id,
      },
    },
    create: {
      nationCode: input.nationCode,
      carrierId: carrier.id,
      isPrimary: input.isPrimary ?? false,
    },
    update: {
      isPrimary: input.isPrimary ?? undefined,
    },
    include: { carrier: true },
  });
}

/**
 * List carriers authorized for a nation.
 */
export async function getNationCarriers(nationCode: string) {
  if (isRemote()) return remoteGetNationCarriers(nationCode);
  return prisma.registryNationBinding.findMany({
    where: { nationCode },
    include: {
      carrier: {
        select: { domain: true, callBaseUrl: true, name: true, status: true },
      },
    },
    orderBy: { registeredAt: 'asc' },
  });
}

// ── Self-Registration Helper ─────────────────────────────

/**
 * Carrier self-registers with the registry, binding itself and all its
 * active nations. Called on startup or lazily on first request.
 *
 * Uses environment variables:
 * - CARRIER_DOMAIN (default: 'moltphone.ai')
 * - CARRIER_PUBLIC_KEY (required in production)
 * - NEXT_PUBLIC_BASE_URL (for call base URL)
 */
export async function selfRegister() {
  // No short-circuit for remote mode: registerCarrier(), bindNation(), and
  // bindNumber() each check isRemote() individually, so the cascading calls
  // below naturally dispatch to the remote registry when REGISTRY_MODE=remote.
  const domain = process.env.CARRIER_DOMAIN || 'moltphone.ai';
  const publicKey = process.env.CARRIER_PUBLIC_KEY || 'dev-public-key';
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const callBaseUrl = `${baseUrl}/call`;

  // Register the carrier
  const carrier = await registerCarrier({
    domain,
    publicKey,
    callBaseUrl,
    name: 'MoltPhone',
  });

  // Bind all active nations to this carrier
  const nations = await prisma.nation.findMany({
    where: { isActive: true },
    select: { code: true, type: true },
  });

  for (const nation of nations) {
    await bindNation({
      nationCode: nation.code,
      carrierDomain: domain,
      isPrimary: true,
    });
  }

  // Bind all active agents' numbers
  const agents = await prisma.agent.findMany({
    where: { isActive: true },
    select: { moltNumber: true, nationCode: true },
  });

  for (const agent of agents) {
    await bindNumber({
      moltNumber: agent.moltNumber,
      carrierDomain: domain,
      nationCode: agent.nationCode,
    });
  }

  return { carrier, nationsRegistered: nations.length, numbersRegistered: agents.length };
}

// ── Constants ────────────────────────────────────────────

/** The carrier's own domain, used to detect "local" numbers. */
export function getCarrierDomain(): string {
  return process.env.CARRIER_DOMAIN || 'moltphone.ai';
}
