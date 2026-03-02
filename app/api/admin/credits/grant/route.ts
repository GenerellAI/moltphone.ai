/**
 * POST /api/admin/credits/grant
 *
 * Admin-only endpoint to grant credits to a user.
 *
 * Body:
 *   userId      — Target user ID
 *   amount      — Number of credits to grant (positive integer)
 *   description — Optional reason
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { adminGrantCredits } from '@/lib/services/credits';
import { z } from 'zod';

const grantSchema = z.object({
  userId: z.string().min(1),
  amount: z.number().int().min(1).max(1_000_000),
  description: z.string().max(500).optional(),
});

export async function POST(req: NextRequest) {
  const adminErr = await requireAdmin();
  if (adminErr) return adminErr;

  try {
    const body = await req.json();
    const { userId, amount, description } = grantSchema.parse(body);

    const newBalance = await adminGrantCredits(userId, amount, description);

    return NextResponse.json({
      ok: true,
      userId,
      granted: amount,
      balance: newBalance,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
