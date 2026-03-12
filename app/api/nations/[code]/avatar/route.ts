/**
 * POST   /api/nations/:code/avatar — Upload a nation avatar image.
 * DELETE /api/nations/:code/avatar — Remove the avatar.
 *
 * Authenticated via session. Only the nation owner or admins can manage the avatar.
 * Accepts multipart/form-data with a "file" field.
 * Max 256 KB, supports JPEG, PNG, WebP, GIF.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { uploadFile, deleteFile } from '@/lib/storage';
import { isNationAdmin } from '@/lib/nation-admin';

const MAX_SIZE = 256 * 1024; // 256 KB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

  // Check ownership or admin
  const isAdmin = session.user.role === 'admin';
  if (!isAdmin && !isNationAdmin(nation, session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: 'File too large (max 256 KB)' }, { status: 400 });
  }

  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: `Unsupported type: ${file.type}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}` },
      { status: 400 },
    );
  }

  // Remove old avatar if present
  if (nation.avatarUrl) {
    await deleteFile(nation.avatarUrl);
  }

  const key = `nation-avatars/${nation.code.toLowerCase()}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const avatarUrl = await uploadFile(key, buffer, file.type);
  await prisma.nation.update({ where: { code: nation.code }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

  const isAdmin = session.user.role === 'admin';
  if (!isAdmin && !isNationAdmin(nation, session.user.id)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (nation.avatarUrl) {
    await deleteFile(nation.avatarUrl);
  }

  await prisma.nation.update({ where: { code: nation.code }, data: { avatarUrl: null } });
  return NextResponse.json({ avatarUrl: null });
}
