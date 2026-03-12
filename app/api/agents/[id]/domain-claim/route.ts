import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateDomainClaimToken, validateDomainClaimDns } from 'moltnumber';
import { validateWebhookUrl } from '@/lib/ssrf';
import { CARRIER_DOMAIN, CARRIER_NAME, CARRIER_URL } from '@/carrier.config';

const CLAIM_TTL_HOURS = 48;
const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 8192;

function buildWellKnownUrl(domain: string): string {
  const clean = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return `https://${clean}/.well-known/moltnumber.json`;
}

/** Build a structured JSON verification file with one or more agents */
function buildVerificationJson(
  primaryAgent: { moltNumber: string; nationCode: string },
  token: string,
  expiresAt: string,
  extraAgents: Array<{ moltNumber: string; nationCode: string }> = [],
): string {
  const allAgents = [primaryAgent, ...extraAgents];
  return JSON.stringify({
    $schema: 'https://moltprotocol.org/schemas/moltnumber-v1.json',
    version: '1',
    description: `MoltNumber domain verification file. MoltPhone is a phone network for AI agents, built on MoltProtocol — an open telephony layer (like SIP for the AI era) on top of Google's A2A transport. This file proves ownership of this domain by agents registered with ${CARRIER_NAME} (${CARRIER_DOMAIN}). Learn more at https://moltprotocol.org`,
    carrier: {
      name: CARRIER_NAME,
      domain: CARRIER_DOMAIN,
      url: CARRIER_URL,
    },
    protocol: {
      name: 'MoltProtocol',
      url: 'https://moltprotocol.org',
    },
    verification: {
      token,
      molt_number: primaryAgent.moltNumber,
      expires_at: expiresAt,
    },
    agents: allAgents.map(a => ({
      molt_number: a.moltNumber,
      nation_code: a.nationCode,
      agent_card_url: `${CARRIER_URL}/call/${a.moltNumber}/agent.json`,
    })),
  }, null, 2);
}

/** Parse verification file — supports both new JSON and legacy plain-text */
function parseVerificationFile(body: string): { moltnumber: string | null; token: string | null } {
  const result: { moltnumber: string | null; token: string | null } = { moltnumber: null, token: null };
  // Try JSON first
  try {
    const json = JSON.parse(body);
    if (json?.verification?.molt_number) result.moltnumber = json.verification.molt_number;
    if (json?.verification?.token) result.token = json.verification.token;
    if (result.moltnumber && result.token) return result;
  } catch { /* Not JSON, try plain text */ }
  // Legacy plain-text format: "moltnumber: XXX\ntoken: YYY"
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    const mnMatch = trimmed.match(/^moltnumber:\s*(.+)$/i);
    if (mnMatch) { result.moltnumber = mnMatch[1].trim(); continue; }
    const tkMatch = trimmed.match(/^token:\s*(.+)$/i);
    if (tkMatch) { result.token = tkMatch[1].trim(); }
  }
  return result;
}

// POST — initiate a domain claim for an agent
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { domain, includeAgentIds } = body as { domain?: string; includeAgentIds?: string[] };
  if (!domain || typeof domain !== 'string') {
    return NextResponse.json({ error: 'domain is required' }, { status: 400 });
  }

  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

  // SSRF check on the domain
  const ssrfCheck = await validateWebhookUrl(`https://${cleanDomain}`);
  if (!ssrfCheck.ok) {
    return NextResponse.json({ error: `Invalid domain: ${ssrfCheck.reason}` }, { status: 400 });
  }

  // Fetch additional agents owned by the same user if requested
  let extraAgents: Array<{ moltNumber: string; nationCode: string }> = [];
  if (includeAgentIds && Array.isArray(includeAgentIds) && includeAgentIds.length > 0) {
    const others = await prisma.agent.findMany({
      where: {
        id: { in: includeAgentIds.filter(aid => aid !== id) },
        ownerId: session.user.id,
        isActive: true,
      },
      select: { moltNumber: true, nationCode: true },
    });
    extraAgents = others;
  }

  const token = generateDomainClaimToken();
  const expiresAt = new Date(Date.now() + CLAIM_TTL_HOURS * 60 * 60 * 1000);

  const claim = await prisma.domainClaim.upsert({
    where: { agentId_domain: { agentId: id, domain: cleanDomain } },
    update: { token, status: 'pending', expiresAt, verifiedAt: null },
    create: { agentId: id, domain: cleanDomain, token, expiresAt },
  });

  const fileContents = buildVerificationJson(
    { moltNumber: agent.moltNumber, nationCode: agent.nationCode },
    token,
    expiresAt.toISOString(),
    extraAgents,
  );

  return NextResponse.json({
    claim_id: claim.id,
    domain: cleanDomain,
    methods: {
      http: {
        url: buildWellKnownUrl(cleanDomain),
        file_contents: fileContents,
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

// PUT — verify a pending domain claim by fetching /.well-known/moltnumber.json (or .txt fallback)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const reqBody = await req.json();
  const { domain, method: verifyMethod } = reqBody;
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
    // HTTP Well-Known verification — try .json first, fall back to .txt
    const jsonUrl = buildWellKnownUrl(cleanDomain);
    const txtUrl = jsonUrl.replace(/\.json$/, '.txt');
    const ssrfCheck = await validateWebhookUrl(jsonUrl);
    if (!ssrfCheck.ok) {
      return NextResponse.json({ error: `SSRF blocked: ${ssrfCheck.reason}` }, { status: 400 });
    }

    let fileBody: string | null = null;
    proofUrl = jsonUrl;

    // Try .json
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(jsonUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'MoltNumber-Verifier/1.0' },
      });
      clearTimeout(timer);
      if (response.ok) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength <= MAX_RESPONSE_BYTES) {
          fileBody = new TextDecoder().decode(buffer);
        }
      }
    } catch { /* will try .txt */ }

    // Fallback to .txt
    if (!fileBody) {
      proofUrl = txtUrl;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        const response = await fetch(txtUrl, {
          signal: controller.signal,
          headers: { 'User-Agent': 'MoltNumber-Verifier/1.0' },
        });
        clearTimeout(timer);
        if (!response.ok) {
          await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'failed' } });
          return NextResponse.json({ error: `No moltnumber.json or moltnumber.txt found at ${cleanDomain}` }, { status: 422 });
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_BYTES) {
          return NextResponse.json({ error: 'Response too large' }, { status: 422 });
        }
        fileBody = new TextDecoder().decode(buffer);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Fetch failed';
        await prisma.domainClaim.update({ where: { id: claim.id }, data: { status: 'failed' } });
        return NextResponse.json({ error: `Could not fetch verification file: ${message}` }, { status: 422 });
      }
    }

    const parsed = parseVerificationFile(fileBody);
    if (parsed.moltnumber === agent.moltNumber && parsed.token === claim.token) {
      result = { valid: true };
    } else {
      result = { valid: false, reason: parsed.moltnumber !== agent.moltNumber ? 'MoltNumber mismatch' : 'Token mismatch' };
    }
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
