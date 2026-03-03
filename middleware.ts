import { NextRequest, NextResponse } from 'next/server';

/**
 * Subdomain routing middleware.
 *
 * Routes requests from `dial.moltphone.ai/<number>/...` to the internal
 * `/dial/<number>/...` routes. This keeps the A2A protocol surface on a
 * separate subdomain from the web UI, providing:
 *
 * - Cookie isolation (session cookies are never sent to dial.*)
 * - Independent rate limiting / scaling
 * - Cleaner URLs for machine clients
 *
 * In development, use the `X-Forwarded-Host` header or `Host` header to
 * simulate the subdomain:
 *
 *   curl -H "Host: dial.localhost:3000" http://localhost:3000/MOLT-.../tasks/send
 *
 * Or just use the existing `/dial/...` path — both work.
 */

const DIAL_SUBDOMAINS = new Set(['dial']);

function getSubdomain(host: string): string | null {
  // Remove port
  const hostname = host.split(':')[0];

  // Dev: dial.localhost
  if (hostname.startsWith('dial.localhost')) return 'dial';

  // Production: dial.moltphone.ai (or any dial.*)
  const parts = hostname.split('.');
  if (parts.length >= 3) {
    const sub = parts[0];
    if (DIAL_SUBDOMAINS.has(sub)) return sub;
  }

  return null;
}

export function middleware(req: NextRequest) {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const subdomain = getSubdomain(host);

  if (subdomain === 'dial') {
    const url = req.nextUrl.clone();
    const originalPath = url.pathname;

    // Rewrite: dial.moltphone.ai/<number>/... → /dial/<number>/...
    // Skip if already prefixed (shouldn't happen, but defensive)
    if (!originalPath.startsWith('/dial/')) {
      url.pathname = `/dial${originalPath}`;
    }

    // Strip session cookies — dial subdomain should never carry user sessions
    const response = NextResponse.rewrite(url);
    response.cookies.delete('next-auth.session-token');
    response.cookies.delete('__Secure-next-auth.session-token');
    response.cookies.delete('next-auth.csrf-token');

    return response;
  }

  // Block direct access to /dial/ — must go through subdomain
  // Allow internal server-side requests (from chat proxy, etc.)
  // Allow all /dial/ in development (no real subdomain available)
  if (req.nextUrl.pathname.startsWith('/dial/')) {
    const isDev = process.env.NODE_ENV === 'development';
    const isInternal = req.headers.get('x-molt-internal') === (process.env.NEXTAUTH_SECRET || 'dev-secret-change-me');
    if (!isDev && !isInternal) {
      return NextResponse.json({ error: 'Use dial.moltphone.ai instead' }, { status: 404 });
    }
  }

  return NextResponse.next();
}

export const config = {
  // Run on all routes except static assets and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
