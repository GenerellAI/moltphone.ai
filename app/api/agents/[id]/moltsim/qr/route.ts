import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import QRCode from 'qrcode';

const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://localhost:3000/dial';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  const slug = agent.phoneNumber;
  // Encode the full MoltSIM profile structure (minus private_key, which is not stored)
  const profile = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    phone_number: agent.phoneNumber,
    carrier_dial_base: DIAL_BASE_URL,
    inbox_url: `${DIAL_BASE_URL}/${slug}/tasks`,
    task_reply_url: `${DIAL_BASE_URL}/${slug}/tasks/:id/reply`,
    task_cancel_url: `${DIAL_BASE_URL}/${slug}/tasks/:id/cancel`,
    presence_url: `${DIAL_BASE_URL}/${slug}/presence/heartbeat`,
    public_key: agent.publicKey,
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
  };
  
  const qr = await QRCode.toDataURL(JSON.stringify(profile));
  return NextResponse.json({ qr });
}
