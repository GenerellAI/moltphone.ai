import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const nation = await prisma.nation.findUnique({ where: { code: params.code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  
  const agents = await prisma.agent.findMany({
    where: { nationCode: params.code.toUpperCase(), isActive: true },
    select: {
      id: true, phoneNumber: true, displayName: true, nationCode: true,
      lastSeenAt: true, dndEnabled: true, description: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(agents);
}
