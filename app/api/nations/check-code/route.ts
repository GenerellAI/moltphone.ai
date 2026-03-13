/**
 * GET /api/nations/check-code?code=XXXX
 *
 * Public endpoint that checks if a nation code is available, blocked, or
 * claimable via domain verification. Used by the nation creation form for
 * live feedback.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  BLOCKED_NATION_CODES,
  CLAIMABLE_NATION_DOMAINS,
} from '@/lib/services/credits';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')?.toUpperCase();

  if (!code || !/^[A-Z]{4}$/.test(code)) {
    return NextResponse.json({ status: 'invalid', message: 'Nation code must be 4 uppercase letters' });
  }

  // System blocked
  if (BLOCKED_NATION_CODES.includes(code)) {
    return NextResponse.json({ status: 'blocked', message: `${code} is a reserved system code` });
  }

  // Country code (claimable domain = empty string)
  const claimableDomain = CLAIMABLE_NATION_DOMAINS[code];
  if (claimableDomain === '') {
    return NextResponse.json({ status: 'blocked', message: `${code} is reserved` });
  }

  // Already taken
  const existing = await prisma.nation.findUnique({ where: { code } });
  if (existing) {
    return NextResponse.json({ status: 'taken', message: `${code} is already registered` });
  }

  // Claimable with domain verification
  if (claimableDomain) {
    return NextResponse.json({
      status: 'claimable',
      domain: claimableDomain,
      message: `${code} is reserved for ${claimableDomain}. You can claim it by verifying domain ownership.`,
    });
  }

  // Available
  return NextResponse.json({ status: 'available', message: `${code} is available` });
}
