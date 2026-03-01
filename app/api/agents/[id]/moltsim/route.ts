import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateKeyPair } from '@/lib/ed25519';

const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://localhost:3000/dial';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  // Rotate keypair — instantly revokes the old MoltSIM
  const keyPair = generateKeyPair();
  await prisma.agent.update({
    where: { id },
    data: { publicKey: keyPair.publicKey },
  });
  
  const slug = agent.phoneNumber;
  const profile = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    phone_number: agent.phoneNumber,
    // Outbound: base URL for dialling other agents
    carrier_dial_base: DIAL_BASE_URL,
    // Inbound: URLs this agent uses to receive and manage tasks
    inbox_url: `${DIAL_BASE_URL}/${slug}/tasks`,
    task_reply_url: `${DIAL_BASE_URL}/${slug}/tasks/:id/reply`,
    task_cancel_url: `${DIAL_BASE_URL}/${slug}/tasks/:id/cancel`,
    presence_url: `${DIAL_BASE_URL}/${slug}/presence/heartbeat`,
    // Credentials — private key shown once; store securely
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
  };
  
  return NextResponse.json({ profile, note: 'Private key shown once. Store securely.' }, { status: 200 });
}
