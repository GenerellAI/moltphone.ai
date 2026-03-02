import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const agents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Strip sensitive fields
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return NextResponse.json(agents.map(({ endpointUrl: _eu, publicKey: _pk, ...rest }) => rest));
}
