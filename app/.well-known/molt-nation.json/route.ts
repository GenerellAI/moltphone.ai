/**
 * GET /.well-known/molt-nation.json
 *
 * Public endpoint serving nation delegation information for this carrier.
 *
 * Returns all active delegations where this carrier has been authorized
 * by org/carrier nation owners. Enables cross-carrier verification:
 * a remote carrier can fetch this to verify that another carrier is
 * authorized to manage agents under a given nation code.
 *
 * Response keyed by nation code for easy lookup.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { CARRIER_DOMAIN } from '@/lib/carrier-identity';

export async function GET() {
  // Find all active (non-revoked, non-expired) delegations for this carrier
  const delegations = await prisma.nationDelegation.findMany({
    where: {
      carrierDomain: CARRIER_DOMAIN,
      revokedAt: null,
    },
    include: {
      nation: {
        select: {
          code: true,
          type: true,
          displayName: true,
          publicKey: true,
          verifiedDomain: true,
        },
      },
    },
    orderBy: { nationCode: 'asc' },
  });

  // Filter out expired delegations in code (DB doesn't have a simple < check on nullable DateTime)
  const now = new Date();
  const active = delegations.filter(d => !d.expiresAt || d.expiresAt > now);

  const nations: Record<string, {
    nation_code: string;
    nation_type: string;
    nation_name: string;
    nation_public_key: string | null;
    verified_domain: string | null;
    delegation: {
      carrier_domain: string;
      carrier_public_key: string;
      issued_at: number;
      expires_at: number | null;
      signature: string;
    };
  }> = {};

  for (const d of active) {
    nations[d.nationCode] = {
      nation_code: d.nationCode,
      nation_type: d.nation.type,
      nation_name: d.nation.displayName,
      nation_public_key: d.nation.publicKey,
      verified_domain: d.nation.verifiedDomain,
      delegation: {
        carrier_domain: d.carrierDomain,
        carrier_public_key: d.carrierPublicKey,
        issued_at: Math.floor(d.issuedAt.getTime() / 1000),
        expires_at: d.expiresAt ? Math.floor(d.expiresAt.getTime() / 1000) : null,
        signature: d.signature,
      },
    };
  }

  return NextResponse.json(
    {
      version: '1',
      carrier_domain: CARRIER_DOMAIN,
      nations,
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/json',
      },
    },
  );
}
