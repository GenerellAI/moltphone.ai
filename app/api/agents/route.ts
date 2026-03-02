import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { InboundPolicy } from '@prisma/client';
import { generatePhoneNumber } from '@/lib/phone-number';
import { generateKeyPair } from '@/lib/ed25519';
import { validateWebhookUrl } from '@/lib/ssrf';
import { requireHttps } from '@/lib/require-https';
import { issueRegistrationCertificate } from '@/lib/carrier-identity';
import { z } from 'zod';

const createSchema = z.object({
  nationCode: z.string().regex(/^[A-Z]{4}$/),
  displayName: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  endpointUrl: z.string().url().optional().nullable(),
  dialEnabled: z.boolean().default(true),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).default('public'),
  awayMessage: z.string().max(500).optional().nullable(),
  skills: z.array(z.string()).default(['call', 'text']),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  const nation = searchParams.get('nation') || '';
  
  const agents = await prisma.agent.findMany({
    where: {
      isActive: true,
      ...(q ? {
        OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { phoneNumber: { contains: q.toUpperCase() } },
          { description: { contains: q, mode: 'insensitive' } },
        ]
      } : {}),
      ...(nation ? { nationCode: nation.toUpperCase() } : {}),
    },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  
  // Strip sensitive fields from list response
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return NextResponse.json(agents.map(({ endpointUrl: _eu, publicKey: _pk, ...rest }) => rest));
}

export async function POST(req: NextRequest) {
  // Private key is returned in the response — require encrypted transport
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  try {
    const body = await req.json();
    const data = createSchema.parse(body);

    // Verify the session user still exists (e.g. after a re-seed)
    const user = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!user) return NextResponse.json({ error: 'Session expired — please log out and log back in' }, { status: 401 });
    
    const nation = await prisma.nation.findUnique({ where: { code: data.nationCode } });
    if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
    
    if (!nation.isPublic && nation.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Nation is restricted; only the owner may register agents' }, { status: 403 });
    }
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint URL: ${check.reason}` }, { status: 400 });
    }
    
    // Generate keypair first — the MoltNumber is derived from the public key
    const keyPair = generateKeyPair();
    const phoneNumber = generatePhoneNumber(data.nationCode, keyPair.publicKey);
    
    // Self-certifying numbers are deterministic from the key, but check for
    // the astronomically unlikely collision (2^-40 probability per attempt)
    const exists = await prisma.agent.findUnique({ where: { phoneNumber } });
    if (exists) return NextResponse.json({ error: 'Phone number collision — please retry' }, { status: 409 });
    
    const agent = await prisma.agent.create({
      data: {
        phoneNumber,
        nationCode: data.nationCode,
        ownerId: session.user.id,
        displayName: data.displayName,
        description: data.description,
        endpointUrl: data.endpointUrl,
        dialEnabled: data.dialEnabled,
        inboundPolicy: data.inboundPolicy as InboundPolicy,
        awayMessage: data.awayMessage,
        publicKey: keyPair.publicKey,
        skills: data.skills,
      },
      include: {
        nation: { select: { code: true, displayName: true, badge: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    
    // Return MoltPage fields + private key (shown once)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { endpointUrl: _eu, publicKey: _pk, ...moltPage } = agent;

    // Issue registration certificate — carrier's signature proving this agent was registered
    const registrationCert = issueRegistrationCertificate({
      phoneNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: data.nationCode,
    });

    return NextResponse.json({
      ...moltPage,
      privateKey: keyPair.privateKey,
      registrationCertificate: {
        version: registrationCert.version,
        phone_number: registrationCert.phoneNumber,
        agent_public_key: registrationCert.agentPublicKey,
        nation_code: registrationCert.nationCode,
        carrier_domain: registrationCert.carrierDomain,
        issued_at: registrationCert.issuedAt,
        signature: registrationCert.signature,
      },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('[POST /api/agents] Internal error:', e);
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: `Internal error: ${message}` }, { status: 500 });
  }
}
