import { NextRequest, NextResponse } from 'next/server';

/**
 * Require HTTPS in production for routes that return sensitive key material.
 *
 * Returns a 403 response if the request is over plain HTTP in production.
 * In development (NODE_ENV !== 'production'), all requests are allowed.
 *
 * Check methods:
 * 1. `x-forwarded-proto` header (set by reverse proxies / load balancers)
 * 2. Request URL scheme
 */
export function requireHttps(req: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== 'production') return null;

  const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
  if (proto === 'https') return null;

  return NextResponse.json(
    { error: 'HTTPS required — this endpoint returns sensitive key material' },
    { status: 403 },
  );
}
