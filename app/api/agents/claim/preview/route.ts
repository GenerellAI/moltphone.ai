/**
 * GET /api/agents/claim/preview?token=<claimToken>
 *
 * Public endpoint — returns basic info about an unclaimed agent
 * so the claim UI can show what's being claimed. No auth required.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token parameter.' }, { status: 400 });
  }

  const agent = await prisma.agent.findFirst({
    where: {
      claimToken: token,
      ownerId: null,
      isActive: true,
    },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
    },
  });

  if (!agent) {
    return NextResponse.json({ error: 'Invalid or already-claimed token.' }, { status: 404 });
  }

  if (agent.claimExpiresAt && agent.claimExpiresAt < new Date()) {
    return NextResponse.json({ error: 'This claim link has expired.' }, { status: 410 });
  }

  return NextResponse.json({
    agent: {
      id: agent.id,
      moltNumber: agent.moltNumber,
      displayName: agent.displayName,
      nationCode: agent.nationCode,
      description: agent.description,
      skills: agent.skills,
      nationName: agent.nation.displayName,
      nationBadge: agent.nation.badge,
      claimExpiresAt: agent.claimExpiresAt?.toISOString(),
    },
  });
}
