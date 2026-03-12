/**
 * GET /api/credits
 *
 * Returns the authenticated user's credit balance and recent transaction history.
 *
 * Query params:
 *   cursor — CreditTransaction ID for pagination
 *   limit  — Max results (default 50, max 100)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getBalance, getTransactionHistory } from '@/lib/services/credits';
import { CREDITS_ENABLED } from '@/carrier.config';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get('cursor') ?? undefined;
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100);

  const [balance, transactions] = await Promise.all([
    getBalance(session.user.id),
    getTransactionHistory(session.user.id, { cursor, limit }),
  ]);

  return NextResponse.json({
    balance,
    enabled: CREDITS_ENABLED,
    transactions,
    nextCursor: transactions.length === limit ? transactions[transactions.length - 1].id : null,
  });
}
