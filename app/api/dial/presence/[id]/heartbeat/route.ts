import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySecret } from '@/lib/secrets';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const secret = req.headers.get('x-voicemail-secret') || req.headers.get('x-call-secret') || '';
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  let valid = false;
  if (agent.voicemailSecretHash) valid = await verifySecret(secret, agent.voicemailSecretHash);
  if (!valid && agent.callSecretHash) valid = await verifySecret(secret, agent.callSecretHash);
  if (!valid) return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
  
  await prisma.agent.update({ where: { id }, data: { lastSeenAt: new Date() } });
  return NextResponse.json({ ok: true, lastSeenAt: new Date() });
}
