/**
 * GET  /api/admin/port-requests          — List port requests (admin)
 * POST /api/admin/port-requests          — Action on a port request (approve/reject)
 *
 * Admin-only endpoints for managing number portability requests.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import {
  listPortRequests,
  approvePortOut,
  rejectPortOut,
  executePort,
} from '@/lib/services/number-portability';
import { PortRequestStatus } from '@prisma/client';
import { z } from 'zod';

// ── GET /api/admin/port-requests ─────────────────────────

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status! });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') as PortRequestStatus | null;

  const portRequests = await listPortRequests(status || undefined);
  return NextResponse.json({ portRequests });
}

// ── POST /api/admin/port-requests ────────────────────────

const actionSchema = z.object({
  portRequestId: z.string().min(1),
  action: z.enum(['approve', 'reject', 'execute']),
  reason: z.string().min(1).optional(), // Required for reject
});

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status! });

  try {
    const body = await req.json();
    const data = actionSchema.parse(body);

    let result: { ok: boolean; error?: string };

    switch (data.action) {
      case 'approve':
        result = await approvePortOut(data.portRequestId);
        break;
      case 'reject':
        if (!data.reason) {
          return NextResponse.json({ error: 'A reason is required when rejecting a port request' }, { status: 400 });
        }
        result = await rejectPortOut(data.portRequestId, data.reason);
        break;
      case 'execute':
        result = await executePort(data.portRequestId);
        break;
      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action: data.action, portRequestId: data.portRequestId });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
