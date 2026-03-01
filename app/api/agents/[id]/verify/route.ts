import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { validateWebhookUrl } from '@/lib/ssrf';

const FETCH_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 32768; // 32 KB

/**
 * POST — submit a social verification for an agent.
 *
 * Supported providers: x, github
 * Domain verification is handled via /api/agents/[id]/domain-claim instead.
 *
 * Social verification ≠ ownership. Ownership = MoltSIM activation only.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const { provider, handle, proof_url } = body;

  if (!provider || !handle || !proof_url) {
    return NextResponse.json({ error: 'provider, handle, and proof_url are required' }, { status: 400 });
  }

  if (!['x', 'github'].includes(provider)) {
    return NextResponse.json({ error: 'provider must be "x" or "github". Use domain-claim for domain verification.' }, { status: 400 });
  }

  if (typeof proof_url !== 'string' || proof_url.length > 2048) {
    return NextResponse.json({ error: 'Invalid proof_url' }, { status: 400 });
  }

  // SSRF check
  const ssrfCheck = await validateWebhookUrl(proof_url);
  if (!ssrfCheck.ok) {
    return NextResponse.json({ error: `Blocked URL: ${ssrfCheck.reason}` }, { status: 400 });
  }

  // Fetch proof page and search for the agent's MoltNumber
  let pageContent: string;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(proof_url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'MoltNumber-Verifier/1.0' },
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return NextResponse.json({ error: `Could not fetch proof URL (HTTP ${response.status})` }, { status: 422 });
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      return NextResponse.json({ error: 'Proof page too large' }, { status: 422 });
    }
    pageContent = new TextDecoder().decode(buffer);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Fetch failed';
    return NextResponse.json({ error: `Could not fetch proof URL: ${message}` }, { status: 422 });
  }

  // Check if the agent's MoltNumber appears in the page content
  if (!pageContent.includes(agent.phoneNumber)) {
    return NextResponse.json({
      error: `MoltNumber ${agent.phoneNumber} not found in proof page content`,
    }, { status: 422 });
  }

  // Create/update verification
  const verification = await prisma.socialVerification.upsert({
    where: {
      agentId_provider_handleOrDomain: {
        agentId: id,
        provider,
        handleOrDomain: handle,
      },
    },
    update: {
      proofUrl: proof_url,
      status: 'verified',
      verifiedAt: new Date(),
    },
    create: {
      agentId: id,
      provider,
      handleOrDomain: handle,
      proofUrl: proof_url,
      status: 'verified',
      verifiedAt: new Date(),
    },
  });

  return NextResponse.json({
    id: verification.id,
    provider: verification.provider,
    handle: verification.handleOrDomain,
    status: verification.status,
    note: 'Social verification is evidence only. Ownership is verified via MoltSIM activation.',
  });
}

// GET — list social verifications for an agent (public)
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

  const verifications = await prisma.socialVerification.findMany({
    where: { agentId: id },
    select: {
      id: true,
      provider: true,
      handleOrDomain: true,
      proofUrl: true,
      status: true,
      verifiedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(verifications);
}
