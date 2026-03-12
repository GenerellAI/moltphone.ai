import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/notifications/mark-seen — Mark calls or messages as seen.
 *
 * Body: { type: "call" | "text" }
 *
 * Updates the user's lastSeenCallAt or lastSeenMessageAt to now().
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { type?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type } = body;
  if (type !== 'call' && type !== 'text') {
    return NextResponse.json({ error: 'type must be "call" or "text"' }, { status: 400 });
  }

  const now = new Date();
  const data = type === 'call'
    ? { lastSeenCallAt: now }
    : { lastSeenMessageAt: now };

  await prisma.user.update({
    where: { id: session.user.id },
    data,
  });

  return NextResponse.json({ ok: true });
}
