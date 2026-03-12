/**
 * POST /call/:moltNumber/message
 *
 * Human-friendly alias for /call/:moltNumber/tasks/send with molt.intent = "text".
 * Accepts the same body as tasks/send. If metadata.molt.intent is not set,
 * it is injected as "text". Then internally rewrites to tasks/send.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  const { moltNumber } = await params;

  // Parse body, inject intent
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const metadata = (body.metadata as Record<string, unknown>) ?? {};
  if (!metadata['molt.intent']) {
    metadata['molt.intent'] = 'text';
  }
  body.metadata = metadata;

  // Build internal URL to tasks/send
  const url = new URL(`/call/${encodeURIComponent(moltNumber)}/tasks/send`, req.nextUrl.origin);

  // Forward all original headers
  const headers = new Headers(req.headers);
  headers.set('content-type', 'application/json');

  const internal = new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return fetch(internal);
}
