import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateDomainClaimToken, buildWellKnownUrl, validateDomainClaim, validateDomainClaimDns } from 'moltnumber';
import { validateWebhookUrl } from '@/lib/ssrf';

const CLAIM_TTL_HOURS = 48;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 4096;

// POST — initiate a domain claim for an agent
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { domain } = await req.json();
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

  // SSRF check on the domain
  const ssrfCheck = await validateWebhookUrl(`https://${cleanDomain}`);
  if (!ssrfCheck.ok) {
    return NextResponse.json({ error: `Invalid domain: ${ssrfCheck.reason}` }, { status: 400 });
  }

  const token = generateDomainClaimToken();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);

  const claim = await prisma.domainClaim.upsert({
    where: { agentId_domain: { agentId: id, domain: cleanDomain } },
    update: { token, status: 'pending', expiresAt, verifiedAt: null },
    create: { agentId: id, domain: cleanDomain, token, expiresAt },
  });

  return NextResponse.json({
    claim_id: claim.id,
    domain: cleanDomain,
    methods: {
      http: {
        url: buildWellKnownUrl(cleanDomain),
        file_contents: `moltnumber: ${agent.moltNumber}\ntoken: ${token}`,
      },
      dns: {
        record: `_moltnumber.${cleanDomain}`,
        type: 'TXT',
        value: `moltnumber=${agent.moltNumber} token=${token}`,
      },
    },
    expires_at: expiresAt.toISOString(),
  });
}

// PUT — verify a pending domain claim by fetching /.well-known/moltnumber.txt
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { domain, method: verifyMethod } = body;
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }
  const useDns = verifyMethod === 'dns';

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

  const claim = await prisma.domainClaim.findUnique({
    where: { agentId_domain: { agentId: id, domain: cleanDomain } },
  });
  if (!claim) return NextResponse.json({ error: 'No pending claim for this domain' }, { status: 404 });
  if (claim.status === 'verified') return NextResponse.json({ error: 'Already verified' }, { status: 409 });
  if (claim.expiresAt < new Date()) {
    await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'expired' } });
    return NextResponse.json({ error: 'Claim expired, please create a new one' }, { status: 410 });
  }

  let result: { valid: boolean; reason?: string };
  let proofUrl: string;

  if (useDns) {
    // DNS TXT verification
    result = await validateDomainClaimDns(cleanDomain, agent.moltNumber, claim.token);
    proofUrl = `dns:_moltnumber.${cleanDomain}`;
  } else {
    // HTTP Well-Known verification (default)
    const url = buildWellKnownUrl(cleanDomain);
    const ssrfCheck = await validateWebhookUrl(url);
    if (!ssrfCheck.ok) {
      return NextResponse.json({ error: `SSRF blocked: ${ssrfCheck.reason}` }, { status: 400 });
    }

    let fileBody: string;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MoltNumber-Verifier/1.0' },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'failed' } });
        return NextResponse.json({ error: `HTTP ${response.status} from ${url}` }, { status: 422 });
      }
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_RESPONSE_BYTES) {
        return NextResponse.json({ error: 'Response too large' }, { status: 422 });
      }
      fileBody = new TextDecoder().decode(buffer);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Fetch failed';
      await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'failed' } });
      return NextResponse.json({ error: `Could not fetch ${url}: ${message}` }, { status: 422 });
    }

    result = validateDomainClaim(fileBody, agent.moltNumber, claim.token);
    proofUrl = url;
  }

  if (!result.valid) {
    await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'failed' } });
    return NextResponse.json({ error: `Verification failed: ${result.reason}` }, { status: 422 });
  }

  // Mark the claim as verified and create/update a SocialVerification record
  await prisma.$transaction([
    prisma.domainClaim.update({
      where: { id: claim.id },
      data: { status: 'verified', verifiedAt: new Date() },
    }),
    prisma.socialVerification.upsert({
      where: { agentId_provider_handleOrDomain: { agentId: id, provider: 'domain', handleOrDomain: cleanDomain } },
      update: { status: 'verified', verifiedAt: new Date(), proofUrl },
      create: { agentId: id, provider: 'domain', handleOrDomain: cleanDomain, status: 'verified', verifiedAt: new Date(), proofUrl },
    }),
  ]);

  return NextResponse.json({ verified: true, domain: cleanDomain });
}

// GET — list domain claims for an agent
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const claims = await prisma.domainClaim.findMany({
    where: { agentId: id },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(claims);
}

// DELETE — remove a domain claim (and its SocialVerification)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { domain } = await req.json();
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

  await prisma.$transaction([
    prisma.domainClaim.deleteMany({
      where: { agentId: id, domain: cleanDomain },
    }),
    prisma.socialVerification.deleteMany({
      where: { agentId: id, provider: 'domain', handleOrDomain: cleanDomain },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
