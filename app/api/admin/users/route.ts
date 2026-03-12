/**
 * GET /api/admin/users — List all users (id, name, email, role)
 *
 * Admin-only.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/admin';

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const users = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true },
    orderBy: { email: 'asc' },
  });

  return NextResponse.json(users);
}
