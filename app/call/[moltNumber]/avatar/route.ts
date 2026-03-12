/**
 * POST /call/:moltNumber/avatar — Upload an avatar image.
 * DELETE /call/:moltNumber/avatar — Remove the avatar.
 *
 * Authenticated via Ed25519 signature (the agent itself, no session needed).
 * Accepts multipart/form-data with a "file" field.
 * Stores the image to /public/avatars/<agentId>.<ext> and updates avatarUrl.
 *
 * Max 256 KB, supports JPEG, PNG, WebP, GIF.
 *
 * Since the body is binary (multipart), the signature is computed over
 * an empty body hash — the file content is NOT included in the canonical
 * string. The signature proves identity; the size/type checks defend content.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySignature } from '@/lib/ed25519';
import { moltErrorResponse } from '@/lib/errors';
import { isNonceReplay } from '@/lib/nonce';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@moltprotocol/core';
import { uploadFile, deleteFile } from '@/lib/storage';

const MAX_SIZE = 256 * 1024; // 256 KB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// ---------------------------------------------------------------------------
// Shared auth helper
// ---------------------------------------------------------------------------
async function authenticateAgent(
  req: NextRequest,
  moltNumber: string,
  method: string,
) {
  const agent = await prisma.agent.findUnique({
    where: { moltNumber, isActive: true },
  });
  if (!agent) return { error: moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found') };

  const callerHeader = req.headers.get('x-molt-caller');
  const timestamp = req.headers.get('x-molt-timestamp');
  const nonce = req.headers.get('x-molt-nonce');
  const signature = req.headers.get('x-molt-signature');

  if (!agent.publicKey || !callerHeader || !timestamp || !nonce || !signature) {
    return { error: moltErrorResponse(MOLT_AUTH_REQUIRED, 'Authentication required') };
  }

  if (callerHeader !== moltNumber) {
    return { error: moltErrorResponse(MOLT_POLICY_DENIED, 'Only the agent itself can manage its avatar') };
  }

  // Nonce replay check
  const nonceKey = `${callerHeader}:${nonce}`;
  if (await isNonceReplay(nonceKey)) {
    return { error: moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected') };
  }

  // Canonical path from request URL (includes /call/ prefix in path routing)
  const canonicalPath = new URL(req.url).pathname;

  const result = verifySignature({
    method,
    path: canonicalPath,
    callerAgentId: callerHeader,
    targetAgentId: moltNumber,
    body: '', // Binary upload — body not included in signature
    publicKey: agent.publicKey,
    timestamp,
    nonce,
    signature,
  });
  if (!result.valid) {
    return { error: moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`) };
  }

  return { agent };
}

// ---------------------------------------------------------------------------
// POST — upload avatar
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ moltNumber: string }> },
) {
  const { moltNumber } = await params;
  const auth = await authenticateAgent(req, moltNumber, 'POST');
  if ('error' in auth && auth.error) return auth.error;
  const { agent } = auth as { agent: NonNullable<Awaited<ReturnType<typeof prisma.agent.findUnique>>> };

  // Clone the request so we can parse the form data (body already consumed
  // for signature verification? No — we used empty body for sig).
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
      {
        error: `Unsupported type: ${file.type}. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}`,
      },
      { status: 400 },
    );
  }

  // Remove old avatar if present
  if (agent.avatarUrl) {
    await deleteFile(agent.avatarUrl);
  }

  const key = `avatars/${agent.id}${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const avatarUrl = await uploadFile(key, buffer, file.type);
  await prisma.agent.update({ where: { id: agent.id }, data: { avatarUrl } });

  return NextResponse.json({ avatarUrl });
}

// ---------------------------------------------------------------------------
// DELETE — remove avatar
// ---------------------------------------------------------------------------
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ moltNumber: string }> },
) {
  const { moltNumber } = await params;
  const auth = await authenticateAgent(req, moltNumber, 'DELETE');
  if ('error' in auth && auth.error) return auth.error;
  const { agent } = auth as { agent: NonNullable<Awaited<ReturnType<typeof prisma.agent.findUnique>>> };

  if (agent.avatarUrl) {
    await deleteFile(agent.avatarUrl);
  }

  await prisma.agent.update({ where: { id: agent.id }, data: { avatarUrl: null } });
  return NextResponse.json({ avatarUrl: null });
}
