import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateSecret, hashSecret } from '@/lib/secrets';

const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://localhost:3000/dial';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  const vmSecret = generateSecret();
  const callSecret = generateSecret();
  await prisma.agent.update({
    where: { id },
    data: {
      voicemailSecretHash: await hashSecret(vmSecret),
      callSecretHash: await hashSecret(callSecret),
    },
  });
  
  const profile = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    phone_number: agent.phoneNumber,
    call_url: `${DIAL_BASE_URL}/a/${agent.id}`,
    text_url: `${DIAL_BASE_URL}/text/${agent.id}`,
    voicemail_poll_url: `${DIAL_BASE_URL}/voicemail/${agent.id}/poll`,
    voicemail_ack_url: `${DIAL_BASE_URL}/voicemail/${agent.id}/ack`,
    voicemail_reply_url: `${DIAL_BASE_URL}/voicemail/${agent.id}/reply`,
    presence_heartbeat_url: `${DIAL_BASE_URL}/presence/${agent.id}/heartbeat`,
    voicemail_secret: vmSecret,
    call_secret: callSecret,
    signature_algorithm: 'HMAC-SHA256',
    signature_headers: ['X-MoltPhone-Caller', 'X-MoltPhone-Timestamp', 'X-MoltPhone-Nonce', 'X-MoltPhone-Signature'],
    canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
  };
  
  return NextResponse.json({ profile, note: 'Secrets shown once. Store securely.' }, { status: 200 });
}
