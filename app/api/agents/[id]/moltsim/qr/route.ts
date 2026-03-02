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
  const data = JSON.stringify({
    agent_id: agent.id,
    phone_number: agent.phoneNumber,
    carrier_dial_base: DIAL_BASE_URL,
    inbox_url: `${DIAL_BASE_URL}/${slug}/tasks`,
    task_send_url: `${DIAL_BASE_URL}/${slug}/tasks/send`,
    agent_card_url: `${DIAL_BASE_URL}/${slug}/agent.json`,
    public_key: agent.publicKey,
  });
  
  const qr = await QRCode.toDataURL(data);
  return NextResponse.json({ qr });
}
