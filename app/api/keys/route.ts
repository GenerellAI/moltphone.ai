import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateApiKey, hashApiKey, extractPrefix } from '@/lib/api-key-auth';
import { z } from 'zod';

const MAX_KEYS_PER_USER = 10;

const createSchema = z.object({
  name: z.string().min(1).max(100),
  expiresInDays: z.number().int().min(1).max(365).optional(),
});

/**
 * GET /api/keys — List the authenticated user's API keys.
 * Never returns the raw key or hash.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const keys = await prisma.apiKey.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      name: true,
      prefix: true,
      lastUsedAt: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ keys });
}

/**
 * POST /api/keys — Create a new API key.
 * Returns the raw key ONCE in the response.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Email must be verified
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { emailVerifiedAt: true },
  });
  if (!user?.emailVerifiedAt) {
    return NextResponse.json(
      { error: 'Verify your email before creating API keys.' },
      { status: 403 },
    );
  }

  // Key count limit
  const count = await prisma.apiKey.count({
    where: { userId: session.user.id, revokedAt: null },
  });
  if (count >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum ${MAX_KEYS_PER_USER} active API keys allowed.` },
      { status: 403 },
    );
  }

  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    const rawKey = generateApiKey();
    const keyHash = await hashApiKey(rawKey);
    const prefix = extractPrefix(rawKey);

    const expiresAt = data.expiresInDays
      ? new Date(Date.now() + data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const apiKey = await prisma.apiKey.create({
      data: {
        userId: session.user.id,
        name: data.name,
        keyHash,
        prefix,
        expiresAt,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      ...apiKey,
      key: rawKey, // Shown once!
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues }, { status: 400 });
    }
    console.error('[POST /api/keys]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
