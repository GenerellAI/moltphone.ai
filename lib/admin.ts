/**
 * Admin guard helpers.
 *
 * Checks that the current session user has the `admin` role.
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export interface AdminCheck {
  ok: boolean;
  userId?: string;
  status?: number;
  error?: string;
}

/**
 * Verify the current session is an admin user.
 * Returns { ok: true, userId } or { ok: false, status, error }.
 */
export async function requireAdmin(): Promise<AdminCheck> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });

  if (!user || user.role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin access required' };
  }

  return { ok: true, userId: user.id };
}
