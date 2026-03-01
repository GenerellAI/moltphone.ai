import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generatePhoneNumber } from '@/lib/phone-number';
import { generateSecret, hashSecret } from '@/lib/secrets';
import { validateWebhookUrl } from '@/lib/ssrf';
import { z } from 'zod';

const createSchema = z.object({
  nationCode: z.string().regex(/^[A-Z]{4}$/),
  displayName: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  endpointUrl: z.string().url().optional().nullable(),
  dialEnabled: z.boolean().default(true),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).default('public'),
  voicemailGreeting: z.string().max(500).optional().nullable(),
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
  
  return NextResponse.json(agents);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  try {
    const body = await req.json();
    const data = createSchema.parse(body);
    
    const nation = await prisma.nation.findUnique({ where: { code: data.nationCode } });
    if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
    
    if (!nation.isPublic && nation.ownerId !== session.user.id) {
      return NextResponse.json({ error: 'Nation is restricted; only the owner may register agents' }, { status: 403 });
    }
    
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint URL: ${check.reason}` }, { status: 400 });
    }
    
    let phoneNumber = '';
    for (let i = 0; i < 5; i++) {
      const candidate = generatePhoneNumber(data.nationCode);
      const exists = await prisma.agent.findUnique({ where: { phoneNumber: candidate } });
      if (!exists) { phoneNumber = candidate; break; }
    }
    if (!phoneNumber) return NextResponse.json({ error: 'Failed to generate unique phone number' }, { status: 500 });
    
    const vmSecret = generateSecret();
    const callSecret = generateSecret();
    const vmSecretHash = await hashSecret(vmSecret);
    const callSecretHash = await hashSecret(callSecret);
    
    const agent = await prisma.agent.create({
      data: {
        phoneNumber,
        nationCode: data.nationCode,
        ownerId: session.user.id,
        displayName: data.displayName,
        description: data.description,
        endpointUrl: data.endpointUrl,
        dialEnabled: data.dialEnabled,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inboundPolicy: data.inboundPolicy as Parameters<typeof prisma.agent.create>[0]['data']['inboundPolicy'],
        voicemailGreeting: data.voicemailGreeting,
        voicemailSecretHash: vmSecretHash,
        callSecretHash: callSecretHash,
      },
      include: {
        nation: { select: { code: true, displayName: true, badge: true } },
        owner: { select: { id: true, name: true } },
      },
    });
    
    return NextResponse.json({ ...agent, voicemailSecret: vmSecret, callSecret }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
