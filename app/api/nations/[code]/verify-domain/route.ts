/**
 * POST /api/nations/:code/verify-domain — Initiate domain verification for a nation.
 * PUT  /api/nations/:code/verify-domain — Verify the domain via HTTP or DNS.
 * GET  /api/nations/:code/verify-domain — Get current verification status.
 *
 * Nation domain verification proves the nation owner controls a domain.
 * Uses the same well-known/TXT approach as agent domain claims, but binds
 * the nation code instead of a MoltNumber.
 *
 * Well-known file format:
 *   moltnation: <NATION_CODE>
 *   token: <RANDOM_TOKEN>
 *
 * DNS TXT record:
 *   _moltnation.<domain>  TXT  "moltnation=<CODE> token=<TOKEN>"
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isNationAdmin } from '@/lib/nation-admin';
import { validateWebhookUrl } from '@/lib/ssrf';
import crypto from 'crypto';
import { Resolver } from 'dns/promises';

const CLAIM_TTL_HOURS = 48;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4096;

function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

function buildWellKnownUrl(domain: string): string {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${clean}/.well-known/moltnation.txt`;
}

function parseWellKnownFile(body: string): { nation: string | null; token: string | null } {
  const result: { nation: string | null; token: string | null } = { nation: null, token: null };
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const nationMatch = trimmed.match(/^moltnation:\s*(.+)$/i);
    if (nationMatch) {
      result.nation = nationMatch[1].trim();
      continue;
    }
    const tkMatch = trimmed.match(/^token:\s*(.+)$/i);
    if (tkMatch) {
      result.token = tkMatch[1].trim();
    }
  }
  return result;
}

function parseDnsTxtRecord(txt: string): { nation: string | null; token: string | null } {
  const result: { nation: string | null; token: string | null } = { nation: null, token: null };
  const nationMatch = txt.match(/moltnation=(\S+)/i);
  if (nationMatch) result.nation = nationMatch[1];
  const tkMatch = txt.match(/token=(\S+)/i);
  if (tkMatch) result.token = tkMatch[1];
  return result;
}

// ── POST: Initiate domain verification ──────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { domain } = await req.json();
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

  // SSRF check
  const ssrfCheck = await validateWebhookUrl(`https://${cleanDomain}`);
  if (!ssrfCheck.ok) {
    return NextResponse.json({ error: `Invalid domain: ${ssrfCheck.reason}` }, { status: 400 });
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);

  // Store the pending verification in the nation record itself
  // (We reuse verifiedDomain + a temporary token approach)
  // For simplicity, store pending state in memory-like fields.
  // Since nations have at most one domain, we store the token in description metadata.
  // Actually, let's use a clean approach: store pending verification as nation metadata.

  // We'll use a simple approach: store the pending claim data directly on the nation.
  // The nation's verifiedDomain is set only after successful verification.
  await prisma.nation.update({
    where: { code: code.toUpperCase() },
    data: {
      // Store pending domain + token in a JSON string in verifiedDomain temporarily
      // Format: "pending:<domain>:<token>:<expiresAt>"
      verifiedDomain: `pending:${cleanDomain}:${token}:${expiresAt.toISOString()}`,
      domainVerifiedAt: null,
    },
  });

  return NextResponse.json({
    domain: cleanDomain,
    methods: {
      http: {
        url: buildWellKnownUrl(cleanDomain),
        file_contents: `moltnation: ${code.toUpperCase()}\ntoken: ${token}`,
      },
      dns: {
        record: `_moltnation.${cleanDomain}`,
        type: 'TXT',
        value: `moltnation=${code.toUpperCase()} token=${token}`,
      },
    },
    expires_at: expiresAt.toISOString(),
  });
}

// ── PUT: Verify the domain claim ────────────────────────

export async function PUT(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Parse pending verification data
  if (!nation.verifiedDomain?.startsWith('pending:')) {
    if (nation.domainVerifiedAt) {
      return NextResponse.json({ error: 'Domain already verified' }, { status: 409 });
    }
    return NextResponse.json({ error: 'No pending domain verification. Call POST first.' }, { status: 404 });
  }

  // Reconstruct domain (may contain colons — rejoin remaining parts)
  const parts = nation.verifiedDomain.split(':');
  // Format: "pending:<domain>:<token>:<ISO timestamp with colons>"
  // pending, domain, token, then the rest is the ISO date
  const domain = parts[1];
  const token = parts[2];
  const expiryStr = parts.slice(3).join(':');

  if (new Date(expiryStr) < new Date()) {
    await prisma.nation.update({
      where: { code: code.toUpperCase() },
      data: { verifiedDomain: null },
    });
    return NextResponse.json({ error: 'Verification expired. Please initiate a new one.' }, { status: 410 });
  }

  const body = await req.json();
  const verifyMethod = body?.method;
  const useDns = verifyMethod === 'dns';

  let valid = false;
  let reason = '';

  if (useDns) {
    // DNS TXT verification
    const resolver = new Resolver();
    resolver.setServers(['8.8.8.8', '1.1.1.1']);
    const hostname = `_moltnation.${domain}`;

    try {
      const timer = setTimeout(() => resolver.cancel(), FETCH_TIMEOUT_MS);
      const records = await resolver.resolveTxt(hostname);
      clearTimeout(timer);

      // joined for debugging: records.map((r) => r.join('')).join('\n');
      for (const record of records) {
        const txt = record.join('');
        const parsed = parseDnsTxtRecord(txt);
        if (parsed.nation === code.toUpperCase() && parsed.token === token) {
          valid = true;
          break;
        }
      }
      if (!valid) reason = 'TXT record found but values do not match';
    } catch (err: unknown) {
      const errCode = (err as { code?: string }).code;
      if (errCode === 'ENODATA' || errCode === 'ENOTFOUND') {
        reason = `No TXT record found at ${hostname}`;
      } else {
        reason = `DNS error: ${errCode ?? 'unknown'}`;
      }
    }
  } else {
    // HTTP well-known verification (default)
    const url = buildWellKnownUrl(domain);
    const ssrfCheck = await validateWebhookUrl(url);
    if (!ssrfCheck.ok) {
      return NextResponse.json({ error: `SSRF blocked: ${ssrfCheck.reason}` }, { status: 400 });
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MoltNation-Verifier/1.0' },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        return NextResponse.json({ error: `HTTP ${response.status} from ${url}` }, { status: 422 });
      }

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return NextResponse.json({ error: 'Response too large' }, { status: 422 });
      }
      const fileBody = new TextDecoder().decode(buffer);
      const parsed = parseWellKnownFile(fileBody);

      if (parsed.nation === code.toUpperCase() && parsed.token === token) {
        valid = true;
      } else {
        reason = parsed.nation !== code.toUpperCase()
          ? 'Nation code mismatch'
          : 'Token mismatch';
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      return NextResponse.json({ error: `Could not fetch ${url}: ${message}` }, { status: 422 });
    }
  }

  if (!valid) {
    return NextResponse.json({ error: `Verification failed: ${reason}` }, { status: 422 });
  }

  // Success — mark domain as verified
  await prisma.nation.update({
    where: { code: code.toUpperCase() },
    data: {
      verifiedDomain: domain,
      domainVerifiedAt: new Date(),
    },
  });

  return NextResponse.json({
    verified: true,
    domain,
    verified_at: new Date().toISOString(),
  });
}

// ── GET: Check verification status ──────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const nation = await prisma.nation.findUnique({
    where: { code: code.toUpperCase() },
    select: { verifiedDomain: true, domainVerifiedAt: true },
  });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });

  if (nation.domainVerifiedAt && nation.verifiedDomain && !nation.verifiedDomain.startsWith('pending:')) {
    return NextResponse.json({
      status: 'verified',
      domain: nation.verifiedDomain,
      verified_at: nation.domainVerifiedAt.toISOString(),
    });
  }

  if (nation.verifiedDomain?.startsWith('pending:')) {
    const parts = nation.verifiedDomain.split(':');
    const domain = parts[1];
    const expiryStr = parts.slice(3).join(':');
    return NextResponse.json({
      status: 'pending',
      domain,
      expires_at: expiryStr,
    });
  }

  return NextResponse.json({ status: 'none' });
}

// ── DELETE: Remove domain verification ──────────────────

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nation = await prisma.nation.findUnique({ where: { code: code.toUpperCase() } });
  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  await prisma.nation.update({
    where: { code: code.toUpperCase() },
    data: {
      verifiedDomain: null,
      domainVerifiedAt: null,
    },
  });

  return NextResponse.json({ ok: true });
}
