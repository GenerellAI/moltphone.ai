/**
 * POST /api/agents/:id/avatar — Upload an avatar image.
 * DELETE /api/agents/:id/avatar — Remove the avatar.
 *
 * Accepts multipart/form-data with a "file" field.
 * Stores the image to /public/avatars/<agentId>.<ext> and updates avatarUrl.
 *
 * Max 256 KB, supports JPEG, PNG, WebP, GIF.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';

const MAX_SIZE = 256 * 1024; // 256 KB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};
const AVATAR_DIR = path.join(process.cwd(), 'public', 'avatars');

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

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
      { status: 400 }
    );
  }

  await mkdir(AVATAR_DIR, { recursive: true });

  const filename = `${id}${ext}`;
  const filepath = path.join(AVATAR_DIR, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const avatarUrl = `/avatars/${filename}`;
  await prisma.agent.update({ where: { id }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (agent.avatarUrl) {
    const filepath = path.join(process.cwd(), 'public', agent.avatarUrl);
    try { await unlink(filepath); } catch { /* file may not exist */ }
  }

  await prisma.agent.update({ where: { id }, data: { avatarUrl: null } });
  return NextResponse.json({ avatarUrl: null });
}
