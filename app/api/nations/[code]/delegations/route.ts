/**
 * GET  /api/nations/:code/delegations — List delegations for a nation.
 * POST /api/nations/:code/delegations — Create a delegation certificate.
 * DELETE /api/nations/:code/delegations — Revoke a delegation.
 *
 * Delegation certificates prove that a nation owner authorized a carrier
 * to manage agents under their nation code.
 *
 * Only the nation owner can manage delegations. Listing is public for
 * transparency (delegations are public trust assertions).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import {
  createDelegation,
  revokeDelegation,
  listDelegations,
  delegationCertToJSON,
} from '@/lib/services/nation-delegation';
import { requireHttps } from '@/lib/require-https';

// ── GET — List delegations (public) ──────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { code: true, type: true, publicKey: true, isActive: true },
  });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

  const delegations = await listDelegations(nationCode);

  return NextResponse.json({
    nationCode,
    nationType: nation.type,
    nationPublicKey: nation.publicKey,
    delegations: delegations.map(d => ({
      id: d.id,
      carrierDomain: d.carrierDomain,
      carrierPublicKey: d.carrierPublicKey,
      signature: d.signature,
      issuedAt: d.issuedAt.toISOString(),
      expiresAt: d.expiresAt?.toISOString() ?? null,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      isActive: !d.revokedAt && (!d.expiresAt || d.expiresAt > new Date()),
    })),
  });
}

// ── POST — Create a delegation (owner-only) ─────────────

const createSchema = z.object({
  /** Nation owner's Ed25519 private key (base64url PKCS#8 DER). */
  nationPrivateKey: z.string().min(1),
  /** Carrier domain to authorize. Defaults to this carrier. */
  carrierDomain: z.string().optional(),
  /** Carrier public key (base64url). Defaults to this carrier's key. */
  carrierPublicKey: z.string().optional(),
  /** Expiry time (unix seconds). Omit for no expiry. */
  expiresAt: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  // Private key in request — require HTTPS
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { ownerId: true, type: true, isActive: true },
  });

  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (nation.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!nation.isActive) return NextResponse.json({ error: 'Nation has been deactivated' }, { status: 403 });

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    const { delegation, certificate } = await createDelegation({
      nationCode,
      nationPrivateKey: data.nationPrivateKey,
      carrierDomain: data.carrierDomain,
      carrierPublicKey: data.carrierPublicKey,
      expiresAt: data.expiresAt,
    });

    return NextResponse.json({
      delegation: {
        id: delegation.id,
        nationCode: delegation.nationCode,
        carrierDomain: delegation.carrierDomain,
        issuedAt: delegation.issuedAt.toISOString(),
        expiresAt: delegation.expiresAt?.toISOString() ?? null,
      },
      certificate: delegationCertToJSON(certificate),
    }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues }, { status: 400 });
    console.error('[POST /api/nations/:code/delegations]', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    // Map known errors to appropriate status codes
    if (message.includes('no public key')) return NextResponse.json({ error: message }, { status: 400 });
    if (message.includes('only for org or carrier')) return NextResponse.json({ error: message }, { status: 400 });
    if (message.includes('signing failed')) return NextResponse.json({ error: message }, { status: 422 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── DELETE — Revoke a delegation (owner-only) ────────────

const revokeSchema = z.object({
  carrierDomain: z.string().min(1),
});

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { ownerId: true },
  });

  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (nation.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await req.json();
    const data = revokeSchema.parse(body);

    const revoked = await revokeDelegation(nationCode, data.carrierDomain);

    return NextResponse.json({
      revoked: true,
      nationCode,
      carrierDomain: data.carrierDomain,
      revokedAt: revoked.revokedAt?.toISOString(),
    });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues }, { status: 400 });
    console.error('[DELETE /api/nations/:code/delegations]', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    if (message.includes('Record to update not found')) {
      return NextResponse.json({ error: 'Delegation not found' }, { status: 404 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
