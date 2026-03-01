import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySecret } from '@/lib/secrets';

export async function GET(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  const secret = req.headers.get('x-voicemail-secret') || req.nextUrl.searchParams.get('secret') || '';
  
  const { phoneNumber } = await params;
  const agent = await prisma.agent.findUnique({ where: { phoneNumber: `+${phoneNumber}`, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.voicemailSecretHash) return NextResponse.json({ error: 'Voicemail not configured' }, { status: 403 });
  
  const valid = await verifySecret(secret, agent.voicemailSecretHash);
  if (!valid) return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
  
  await prisma.agent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
  
  const voicemails = await prisma.voicemailMessage.findMany({
    where: { agentId: agent.id, isAcked: false },
    orderBy: { createdAt: 'asc' },
  });
  
  return NextResponse.json({ voicemails });
}
