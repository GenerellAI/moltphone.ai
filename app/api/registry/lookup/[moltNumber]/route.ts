/**
 * GET /api/registry/lookup/:moltNumber — Resolve a MoltNumber to its carrier
 *
 * Public endpoint — anyone can look up where a number is routed.
 * This is the core registry operation: "given this number, which carrier?"
 */

import { NextRequest, NextResponse } from 'next/server';
import { lookupNumber } from '@/lib/services/registry';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ moltNumber: string }> },
) {
  const { moltNumber } = await params;

  const result = await lookupNumber(moltNumber);
  if (!result) {
    return NextResponse.json({ error: 'Number not found in registry' }, { status: 404 });
  }

  return NextResponse.json(result);
}
