/**
 * GET /api/registry/nations — List nation-to-carrier bindings
 *
 * Optional ?nationCode=XXXX filter.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNationCarriers } from '@/lib/services/registry';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const nationCode = searchParams.get('nationCode');

  if (nationCode) {
    const bindings = await getNationCarriers(nationCode.toUpperCase());
    return NextResponse.json({ nationCode: nationCode.toUpperCase(), carriers: bindings });
  }

  // Return all nation bindings grouped by nation code
  const bindings = await prisma.registryNationBinding.findMany({
    include: {
      carrier: { select: { domain: true, callBaseUrl: true, name: true, status: true } },
    },
    orderBy: { nationCode: 'asc' },
  });

  // Group by nation code
  const grouped: Record<string, typeof bindings> = {};
  for (const b of bindings) {
    (grouped[b.nationCode] ??= []).push(b);
  }

  return NextResponse.json({ nations: grouped });
}
