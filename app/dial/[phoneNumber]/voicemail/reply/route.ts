import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifySecret } from '@/lib/secrets';
import { z } from 'zod';

const schema = z.object({ voicemail_id: z.string(), reply: z.string().min(1) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  const secret = req.headers.get('x-voicemail-secret') || '';
  const { phoneNumber } = await params;
  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (!agent.voicemailSecretHash) return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  
  const valid = await verifySecret(secret, agent.voicemailSecretHash);
  if (!valid) return NextResponse.json({ error: 'Invalid secret' }, { status: 403 });
  
  const { voicemail_id, reply } = schema.parse(await req.json());
  
  const vm = await prisma.voicemailMessage.update({
    where: { id: voicemail_id, agentId: agent.id },
    data: { reply, repliedAt: new Date(), isAcked: true, isRead: true },
  });
  
  return NextResponse.json({ ok: true, voicemail: vm });
}
