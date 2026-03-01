import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const createSchema = z.object({
  code: z.string().regex(/^[A-Z]{4}$/, 'Nation code must be 4 uppercase letters'),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  badge: z.string().max(10).optional(),
  isPublic: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  
  const nations = await prisma.nation.findMany({
    where: q ? {
      OR: [
        { code: { contains: q.toUpperCase() } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ]
    } : undefined,
    include: {
      _count: { select: { agents: true } },
      owner: { select: { id: true, name: true, email: true } },
    },
    orderBy: { code: 'asc' },
  });
  
  return NextResponse.json(nations);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    
    if (data.code === 'MOLT') return NextResponse.json({ error: 'MOLT is reserved' }, { status: 400 });
    
    const existing = await prisma.nation.findUnique({ where: { code: data.code } });
    if (existing) return NextResponse.json({ error: 'Nation code already taken' }, { status: 409 });
    
    const nation = await prisma.nation.create({
      data: { ...data, ownerId: session.user.id },
      include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { agents: true } } },
    });
    return NextResponse.json(nation, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
