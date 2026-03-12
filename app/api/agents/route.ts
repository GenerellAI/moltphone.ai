import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { InboundPolicy } from '@prisma/client';
import { generateMoltNumber } from '@/lib/molt-number';
import { generateKeyPair } from '@/lib/ed25519';
import { validateWebhookUrl, checkEndpointOwnership } from '@/lib/ssrf';
import { challengeEndpoint } from '@/lib/endpoint-challenge';
import { requireHttps } from '@/lib/require-https';
import { issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON } from '@/lib/carrier-identity';
import { rateLimit } from '@/lib/rate-limit';
import { canCreateAgent, deductAgentCreationCredits, AGENT_CREATION_COST, checkNationGraduation } from '@/lib/services/credits';
import { authenticateApiKey } from '@/lib/api-key-auth';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';
import { checkDelegation } from '@/lib/services/nation-delegation';
import { isNationAdmin } from '@/lib/nation-admin';
import { z } from 'zod';

const createSchema = z.object({
  nationCode: z.string().regex(/^[A-Z]{4}$/),
  displayName: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  badge: z.string().max(10).optional().nullable(),
  endpointUrl: z.string().url().optional().nullable(),
  callEnabled: z.boolean().default(true),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).default('public'),
  awayMessage: z.string().max(500).optional().nullable(),
  skills: z.array(z.string()).default(['call', 'text']),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const moltNum = searchParams.get('moltNumber') || searchParams.get('phone') || '';
  const q = searchParams.get('q') || '';
  const nation = searchParams.get('nation') || '';
  const mine = searchParams.get('mine') === 'true';
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10) || 20, 1), 50);
  const offset = Math.max(parseInt(searchParams.get('offset') || '0', 10) || 0, 0);

  // "mine" filter — return only the authenticated user's agents
  if (mine) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const myAgents = await prisma.agent.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true, displayName: true, moltNumber: true, nationCode: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ agents: myAgents });
  }

  // Exact MoltNumber lookup — fast path for DialBar
  if (moltNum) {
    const agent = await prisma.agent.findFirst({
      where: { moltNumber: moltNum.toUpperCase(), isActive: true },
      include: {
        nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    if (!agent) return NextResponse.json([], { status: 200 });
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { endpointUrl: _eu, publicKey: _pk, ...rest } = agent;
    return NextResponse.json([rest]);
  }

  // Optionally exclude the authenticated user's own agents from discovery
  const session = await getServerSession(authOptions);
  const excludeOwnerId = searchParams.get('excludeSelf') !== 'false' && session?.user?.id
    ? session.user.id
    : undefined;

  const agents = await prisma.agent.findMany({
    where: {
      isActive: true,
      ownerId: { not: null }, // exclude unclaimed agents from public listings
      ...(excludeOwnerId ? { ownerId: { not: excludeOwnerId } } : {}),
      ...(q ? {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { moltNumber: { contains: q.toUpperCase() } },
          { description: { contains: q, mode: 'insensitive' } },
        ]
      } : {}),
      ...(nation ? { nationCode: nation.toUpperCase() } : {}),
    },
    include: {
      nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { socialVerifications: { where: { status: 'verified' } }, tasksAsCallee: true, tasksAsCaller: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const total = await prisma.agent.count({
    where: {
      isActive: true,
      ownerId: { not: null },
      ...(excludeOwnerId ? { ownerId: { not: excludeOwnerId } } : {}),
      ...(q ? {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { moltNumber: { contains: q.toUpperCase() } },
          { description: { contains: q, mode: 'insensitive' } },
        ]
      } : {}),
      ...(nation ? { nationCode: nation.toUpperCase() } : {}),
    },
  });
  
  // Strip sensitive fields, flatten _count
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const data = agents.map(({ endpointUrl: _eu, publicKey: _pk, _count, ...rest }) => ({
    ...rest,
    verifiedCount: _count?.socialVerifications ?? 0,
    conversationCount: (_count?.tasksAsCallee ?? 0) + (_count?.tasksAsCaller ?? 0),
  }));
  return NextResponse.json({ agents: data, total, limit, offset });
}

export async function POST(req: NextRequest) {
  // Private key is returned in the response — require encrypted transport
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  
  // Support API key auth as alternative to session
  let userId: string;
  if (session?.user?.id) {
    userId = session.user.id;
  } else {
    const apiKeyUser = await authenticateApiKey(req.headers.get('authorization'));
    if (!apiKeyUser) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = apiKeyUser.id;
  }
  
  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    // ── Sybil Resistance ─────────────────────────────────
    // 0. Email must be verified before creating agents
    const caller = await prisma.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });
    if (!caller?.emailVerifiedAt) {
      return NextResponse.json(
        { error: 'Please verify your email before creating agents.' },
        { status: 403 },
      );
    }

    const rlMax = parseInt(process.env.AGENT_CREATION_RATE_LIMIT || '5', 10);
    const rlKey = `agent-create:${userId}`;
    const rl = await rateLimit(rlKey, { maxRequests: rlMax, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many agent creations. Try again later.' },
        { status: 429 },
      );
    }

    // 2. Per-user quota + cooldown + credit balance check
    const guard = await canCreateAgent(userId);
    if (!guard.ok) {
      return NextResponse.json({ error: guard.reason }, { status: 403 });
    }

    // Verify the user still exists (e.g. after a re-seed)
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'User not found — please log in again' }, { status: 401 });
    
    const nation = await prisma.nation.findUnique({ where: { code: data.nationCode } });
    if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
    if (!nation.isActive) return NextResponse.json({ error: 'Nation has been deactivated' }, { status: 403 });
    
    // Nation type enforcement:
    //   carrier → owner/admin only (carrier-controlled namespace)
    //   org → owner/admin OR carrier with valid delegation certificate
    //   open → anyone if public, owner/admin only if private
    const userIsAdmin = isNationAdmin(nation, userId);
    if (nation.type === 'carrier') {
      if (!userIsAdmin) {
        return NextResponse.json(
          { error: 'Carrier nations only allow the owner to register agents' },
          { status: 403 },
        );
      }
    } else if (nation.type === 'org') {
      if (!userIsAdmin) {
        // Member allowlist: if non-empty, only listed users (+ owner/admins) may create agents
        if (nation.memberUserIds.length > 0 && !nation.memberUserIds.includes(userId)) {
          return NextResponse.json(
            { error: 'You are not a member of this nation. Ask the nation owner to add you.' },
            { status: 403 },
          );
        }
        // Non-owner/admin creating under an org nation — check delegation certificate
        const delegationCheck = await checkDelegation(data.nationCode);
        if (!delegationCheck.ok) {
          return NextResponse.json({ error: delegationCheck.reason }, { status: 403 });
        }
      }
    } else if (!nation.isPublic && !userIsAdmin) {
      return NextResponse.json({ error: 'Nation is restricted; only the owner may register agents' }, { status: 403 });
    }
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint URL: ${check.reason}` }, { status: 400 });
      const ownership = await checkEndpointOwnership(data.endpointUrl, userId);
      if (!ownership.ok) return NextResponse.json({ error: ownership.reason }, { status: 409 });
      const echo = await challengeEndpoint(data.endpointUrl);
      if (!echo.ok) return NextResponse.json({ error: `Endpoint verification failed: ${echo.reason}` }, { status: 422 });
    }
    
    // Generate keypair first — the MoltNumber is derived from the public key
    const keyPair = generateKeyPair();
    const moltNumber = generateMoltNumber(data.nationCode, keyPair.publicKey);
    
    // Self-certifying numbers are deterministic from the key, but check for
    // the astronomically unlikely collision (2^-40 probability per attempt)
    const exists = await prisma.agent.findUnique({ where: { moltNumber } });
    if (exists) return NextResponse.json({ error: 'MoltNumber collision — please retry' }, { status: 409 });
    
    const agent = await prisma.agent.create({
      data: {
        moltNumber,
        nationCode: data.nationCode,
        ownerId: userId,
        displayName: data.displayName,
        description: data.description,
        badge: data.badge || null,
        endpointUrl: data.endpointUrl,
        callEnabled: data.callEnabled,
        inboundPolicy: data.inboundPolicy as InboundPolicy,
        awayMessage: data.awayMessage,
        publicKey: keyPair.publicKey,
        skills: data.skills,
      },
      include: {
        nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    
    // Return MoltPage fields + private key (shown once)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { endpointUrl: _eu, publicKey: _pk, ...moltPage } = agent;

    // Issue registration certificate — carrier's signature proving this agent was registered
    const registrationCert = issueRegistrationCertificate({
      moltNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: data.nationCode,
    });

    // 3. Deduct agent creation credits (Sybil cost)
    const deduction = await deductAgentCreationCredits(userId, moltNumber);
    if (!deduction.ok) {
      // Rollback: soft-delete the agent we just created
      await prisma.agent.update({ where: { id: agent.id }, data: { isActive: false } });
      return NextResponse.json(
        { error: `Insufficient credits. Agent creation costs ${AGENT_CREATION_COST} credits.` },
        { status: 402 },
      );
    }

    // 4. Check if this agent puts the nation over the graduation threshold
    await checkNationGraduation(data.nationCode).catch(() => {/* non-critical */});

    // 5. Register the number with the MoltNumber registry (best-effort)
    bindNumber({ moltNumber, carrierDomain: getCarrierDomain(), nationCode: data.nationCode }).catch(() => {/* non-critical */});

    return NextResponse.json({
      ...moltPage,
      privateKey: keyPair.privateKey,
      registrationCertificate: registrationCertToJSON(registrationCert),
      carrierCertificate: getCarrierCertificateJSON(),
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('[POST /api/agents] Internal error:', e);
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: `Internal error: ${message}` }, { status: 500 });
  }
}
