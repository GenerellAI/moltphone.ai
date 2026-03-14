import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { unbindNumber } from '@/lib/services/registry';

// GET /api/settings — fetch current user profile
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      personalAgentId: true,
      passwordHash: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Don't expose the actual hash — just whether a password is set
  const { passwordHash, ...profile } = user;

  // Mask synthetic OAuth emails — they're internal placeholders, not real addresses
  if (profile.email.endsWith('@oauth.moltphone.ai')) {
    (profile as Record<string, unknown>).email = null;
  }

  // Include personal agent fields
  let personalAgentDescription: string | null = null;
  let personalAgentBadge: string | null = null;
  let personalAgentAvatarUrl: string | null = null;
  if (user.personalAgentId) {
    const pa = await prisma.agent.findUnique({
      where: { id: user.personalAgentId },
      select: { description: true, badge: true, avatarUrl: true },
    });
    personalAgentDescription = pa?.description ?? null;
    personalAgentBadge = pa?.badge ?? null;
    personalAgentAvatarUrl = pa?.avatarUrl ?? null;
  }

  return NextResponse.json({ user: { ...profile, hasPassword: !!passwordHash, personalAgentDescription, personalAgentBadge, personalAgentAvatarUrl } });
}

// PATCH /api/settings — update user profile
const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).optional(),
});
// Note: currentPassword is only required if the user already has a password.
// OAuth-only users can set their first password without providing one.

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { name, currentPassword, newPassword } = parsed.data;

  // If changing password, verify current password first (only if user has one)
  if (newPassword) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { passwordHash: true },
    });
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }
    // Users with an existing password must provide it to change
    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
      }
      const valid = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
      }
    }
    // OAuth-only users (no passwordHash) can set their first password freely
  }

  // Build update payload
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) {
    // Check for duplicate display names (case-insensitive)
    const trimmed = name.trim();
    if (trimmed) {
      const duplicate = await prisma.user.findFirst({
        where: {
          name: { equals: trimmed, mode: 'insensitive' },
          id: { not: session.user.id },
        },
        select: { id: true },
      });
      if (duplicate) {
        return NextResponse.json({ error: 'That display name is already taken' }, { status: 409 });
      }
    }
    updateData.name = trimmed;
  }
  if (newPassword) updateData.passwordHash = await bcrypt.hash(newPassword, 10);

  // Personal agent description can be set from user settings
  const personalAgentDescription = body.personalAgentDescription;
  if (typeof personalAgentDescription === 'string' || personalAgentDescription === null) {
    // Fetch the user's personal agent and update its description
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { personalAgentId: true },
    });
    if (user?.personalAgentId) {
      await prisma.agent.update({
        where: { id: user.personalAgentId },
        data: { description: personalAgentDescription ? personalAgentDescription.slice(0, 1000) : null },
      });
    }
  }

  // Sync display name changes to the personal agent
  if (name !== undefined) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { personalAgentId: true },
    });
    if (user?.personalAgentId) {
      await prisma.agent.update({
        where: { id: user.personalAgentId },
        data: { displayName: name },
      });
    }
  }

  if (Object.keys(updateData).length === 0 && personalAgentDescription === undefined) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
  }

  // Only update user if there are user-level changes
  if (Object.keys(updateData).length > 0) {
    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        personalAgentId: true,
      },
    });

    // Fetch personal agent fields for the response
    let paDescription: string | null = null;
    let paBadge: string | null = null;
    let paAvatarUrl: string | null = null;
    if (updated.personalAgentId) {
      const pa = await prisma.agent.findUnique({
        where: { id: updated.personalAgentId },
        select: { description: true, badge: true, avatarUrl: true },
      });
      paDescription = pa?.description ?? null;
      paBadge = pa?.badge ?? null;
      paAvatarUrl = pa?.avatarUrl ?? null;
    }

    return NextResponse.json({ user: { ...updated, hasPassword: !!updateData.passwordHash || undefined, personalAgentDescription: paDescription, personalAgentBadge: paBadge, personalAgentAvatarUrl: paAvatarUrl } });
  }

  // Only personal agent description was updated — re-fetch profile
  const refreshed = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      emailVerifiedAt: true,
      createdAt: true,
      personalAgentId: true,
      passwordHash: true,
    },
  });
  if (!refreshed) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  const { passwordHash: ph2, ...prof2 } = refreshed;
  let paDesc2: string | null = null;
  let paBadge2: string | null = null;
  let paAvatarUrl2: string | null = null;
  if (refreshed.personalAgentId) {
    const pa2 = await prisma.agent.findUnique({ where: { id: refreshed.personalAgentId }, select: { description: true, badge: true, avatarUrl: true } });
    paDesc2 = pa2?.description ?? null;
    paBadge2 = pa2?.badge ?? null;
    paAvatarUrl2 = pa2?.avatarUrl ?? null;
  }
  return NextResponse.json({ user: { ...prof2, hasPassword: !!ph2, personalAgentDescription: paDesc2, personalAgentBadge: paBadge2, personalAgentAvatarUrl: paAvatarUrl2 } });
}

// DELETE /api/settings — delete account and all associated data
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body.confirmation !== 'DELETE MY ACCOUNT') {
    return NextResponse.json({ error: 'You must confirm with "DELETE MY ACCOUNT"' }, { status: 400 });
  }

  const userId = session.user.id;

  // Soft-delete all agents, unbind from registry
  const agents = await prisma.agent.findMany({
    where: { ownerId: userId, isActive: true },
    select: { id: true, moltNumber: true },
  });

  await prisma.$transaction(async (tx) => {
    // Deactivate all agents and wipe their public keys (invalidates MoltSIMs)
    if (agents.length > 0) {
      await tx.agent.updateMany({
        where: { ownerId: userId, isActive: true },
        data: { isActive: false, publicKey: '' },
      });
    }

    // Revoke all API keys
    await tx.apiKey.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    // Delete contacts and blocks
    await tx.contact.deleteMany({ where: { userId } });
    await tx.block.deleteMany({ where: { userId } });

    // Delete email verification tokens
    await tx.emailVerificationToken.deleteMany({ where: { userId } });

    // Clear call policies
    await tx.user.update({
      where: { id: userId },
      data: {
        name: '[deleted]',
        email: `deleted-${userId}@deleted.moltphone.ai`,
        passwordHash: null,
        personalAgentId: null,
        globalCallPolicyIn: Prisma.DbNull,
        globalCallPolicyOut: Prisma.DbNull,
        emailVerifiedAt: null,
      },
    });
  });

  // Unbind numbers from registry (best-effort, outside transaction)
  for (const agent of agents) {
    unbindNumber(agent.moltNumber).catch(() => {/* non-critical */});
  }

  return NextResponse.json({ ok: true });
}
