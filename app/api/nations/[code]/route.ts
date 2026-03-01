import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const nation = await prisma.nation.findUnique({
    where: { code: params.code.toUpperCase() },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { agents: true } },
      agents: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, phoneNumber: true, displayName: true, nationCode: true, lastSeenAt: true, dndEnabled: true },
      },
    },
  });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  return NextResponse.json(nation);
}

const patchSchema = z.object({
  displayName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  badge: z.string().max(10).optional(),
  isPublic: z.boolean().optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: { code: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const nation = await prisma.nation.findUnique({ where: { code: params.code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (nation.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);
    const updated = await prisma.nation.update({
      where: { code: params.code.toUpperCase() },
      data,
      include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { agents: true } } },
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
