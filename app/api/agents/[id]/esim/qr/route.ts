import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import QRCode from 'qrcode';

const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://localhost:3000/dial';

function phoneSlug(phoneNumber: string): string {
  return phoneNumber.replace(/^\+/, '');
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  const slug = phoneSlug(agent.phoneNumber);
  const data = JSON.stringify({
    agent_id: agent.id,
    phone_number: agent.phoneNumber,
    call_url: `${DIAL_BASE_URL}/${slug}/call`,
    text_url: `${DIAL_BASE_URL}/${slug}/text`,
  });
  
  const qr = await QRCode.toDataURL(data);
  return NextResponse.json({ qr });
}
