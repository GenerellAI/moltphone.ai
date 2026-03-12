import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isNationAdmin } from '@/lib/nation-admin';
import { z } from 'zod';

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const nation = await prisma.nation.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      _count: { select: { agents: true } },
      agents: {
        take: 10,
        orderBy: { createdAt: 'desc' },
        select: { id: true, moltNumber: true, displayName: true, nationCode: true, lastSeenAt: true, dndEnabled: true },
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
  memberUserIds: z.array(z.string()).optional(),
  adminUserIds: z.array(z.string()).optional(),
  ownerId: z.string().optional(),
}).strict();

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  try {
    const body = await req.json();
    const data = patchSchema.parse(body);

    // Only the primary owner can transfer ownership or manage admins
    if (data.ownerId !== undefined || data.adminUserIds !== undefined) {
      if (nation.ownerId !== session.user.id) {
        return NextResponse.json(
          { error: 'Only the nation owner can transfer ownership or manage admins' },
          { status: 403 },
        );
      }
    }

    // If transferring ownership, verify the target user exists
    if (data.ownerId) {
      const targetUser = await prisma.user.findUnique({ where: { id: data.ownerId } });
      if (!targetUser) {
        return NextResponse.json({ error: 'Target user not found' }, { status: 404 });
      }
    }

    const updated = await prisma.nation.update({
      where: { code: code.toUpperCase() },
      data,
      include: { owner: { select: { id: true, name: true, email: true } }, _count: { select: { agents: true } } },
    });
    return NextResponse.json(updated);
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
