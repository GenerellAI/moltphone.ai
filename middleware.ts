import { NextRequest, NextResponse } from 'next/server';

/**
 * Subdomain routing middleware.
 *
 * Routes requests from `call.moltphone.ai/<number>/...` to the internal
 * `/call/<number>/...` routes. This keeps the A2A protocol surface on a
 * separate subdomain from the web UI, providing:
 *
 * - Cookie isolation (session cookies are never sent to call.*)
 * - Independent rate limiting / scaling
 * - Cleaner URLs for machine clients
 *
 * In development, use the `X-Forwarded-Host` header or `Host` header to
 * simulate the subdomain:
 *
 *   curl -H "Host: call.localhost:3000" http://localhost:3000/MOLT-.../tasks/send
 *
 * Or just use the existing `/call/...` path — both work.
 */

const COMING_SOON = process.env.COMING_SOON === 'true';
const CALL_SUBDOMAINS = new Set(['call']);

function getSubdomain(host: string): string | null {
  // Remove port
  const hostname = host.split(':')[0];

  // Dev: call.localhost
  if (hostname.startsWith('call.localhost')) return 'call';

  // Production: call.moltphone.ai (or any call.*)
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const sub = parts[0];
    if (CALL_SUBDOMAINS.has(sub)) return sub;
  }

  return null;
}

export function middleware(req: NextRequest) {
  // ── Coming Soon mode: redirect everything except / and static assets ──
  if (COMING_SOON) {
    const path = req.nextUrl.pathname;
    // Allow: homepage, images, favicons, API call routes (for A2A protocol)
    if (path === '/' || path.startsWith('/images/') || path.startsWith('/favicons/') || path.startsWith('/api/') || path.startsWith('/call/')) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const subdomain = getSubdomain(host);

  if (subdomain === 'call') {
    const url = req.nextUrl.clone();
    const originalPath = url.pathname;

    // Rewrite: call.moltphone.ai/<number>/... → /call/<number>/...
    // Skip if already prefixed (shouldn't happen, but defensive)
    if (!originalPath.startsWith('/call/')) {
      url.pathname = `/call${originalPath}`;
    }

    // Strip session cookies — call subdomain should never carry user sessions
    const response = NextResponse.rewrite(url);
    response.cookies.delete('next-auth.session-token');
    response.cookies.delete('__Secure-next-auth.session-token');
    response.cookies.delete('next-auth.csrf-token');

    return response;
  }

  // Block direct access to /call/ — must go through subdomain
  // Allow internal server-side requests (from chat proxy, etc.)
  // Allow all /call/ in development (no real subdomain available)
  // Allow when CALL_HOST matches request host (single-domain staging)
  if (req.nextUrl.pathname.startsWith('/call/')) {
    const isDev = process.env.NODE_ENV === 'development';
    const isInternal = req.headers.get('x-molt-internal') === (process.env.NEXTAUTH_SECRET || 'dev-secret-change-me');
    // Single-domain mode: when CALL_HOST matches the request host, this
    // server IS the call handler (e.g. staging on workers.dev with no
    // call.* subdomain). Allow /call/ paths directly.
    const callHost = process.env.CALL_HOST || '';
    const requestHost = host.split(':')[0];
    const callHostClean = callHost.split(':')[0];
    const isSingleDomain = callHostClean && requestHost === callHostClean;
    if (!isDev && !isInternal && !isSingleDomain) {
      return NextResponse.json({ error: 'Use call.moltphone.ai instead' }, { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static assets and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
