import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateSecret, hashSecret } from '@/lib/secrets';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const agent = await prisma.agent.findUnique({ where: { id: params.id } });
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  const secret = generateSecret();
  await prisma.agent.update({
    where: { id: params.id },
    data: { voicemailSecretHash: await hashSecret(secret) },
  });
  
  return NextResponse.json({ voicemail_secret: secret, note: 'Shown once. Store securely.' });
}
