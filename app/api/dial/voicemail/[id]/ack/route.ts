import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySecret } from '@/lib/secrets';
import { z } from 'zod';

const schema = z.object({ voicemail_id: z.string() });

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const secret = req.headers.get('x-voicemail-secret') || '';
  const agent = await prisma.agent.findUnique({ where: { id: params.id, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.voicemailSecretHash) return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  
  const valid = await verifySecret(secret, agent.voicemailSecretHash);
  if (!valid) return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
  
  const { voicemail_id } = schema.parse(await req.json());
  
  await prisma.voicemailMessage.update({
    where: { id: voicemail_id, agentId: params.id },
    data: { isAcked: true, isRead: true },
  });
  
  return NextResponse.json({ ok: true });
}
