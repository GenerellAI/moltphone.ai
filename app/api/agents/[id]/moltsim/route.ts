import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateKeyPair } from '@/lib/ed25519';
import { generatePhoneNumber } from '@/lib/phone-number';
import { getCarrierPublicKey, issueRegistrationCertificate } from '@/lib/carrier-identity';

const DIAL_BASE_URL = process.env.DIAL_BASE_URL || 'http://localhost:3000/dial';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({ where: { id } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  // Rotate keypair — new key means new self-certifying MoltNumber.
  // This instantly revokes the old MoltSIM and old number.
  const keyPair = generateKeyPair();
  const newPhoneNumber = generatePhoneNumber(agent.nationCode, keyPair.publicKey);
  
  // Check for astronomically unlikely collision
  const exists = await prisma.agent.findFirst({ where: { phoneNumber: newPhoneNumber, id: { not: id } } });
  if (exists) return NextResponse.json({ error: 'Phone number collision — please retry' }, { status: 409 });
  
  await prisma.agent.update({
    where: { id },
    data: { publicKey: keyPair.publicKey, phoneNumber: newPhoneNumber },
  });
  
  const slug = newPhoneNumber;
  const profile = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    phone_number: newPhoneNumber,
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
    // Carrier identity — for verifying X-Molt-Identity on inbound deliveries (MoltUA Level 1)
    carrier_public_key: getCarrierPublicKey(),
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
    // Registration certificate — proves this agent was registered by this carrier
    registration_certificate: (() => {
      const cert = issueRegistrationCertificate({
        phoneNumber: newPhoneNumber,
        agentPublicKey: keyPair.publicKey,
        nationCode: agent.nationCode,
      });
      return {
        version: cert.version,
        phone_number: cert.phoneNumber,
        agent_public_key: cert.agentPublicKey,
        nation_code: cert.nationCode,
        carrier_domain: cert.carrierDomain,
        issued_at: cert.issuedAt,
        signature: cert.signature,
      };
    })(),
  };
  
  return NextResponse.json({ profile, note: 'Private key shown once. Store securely.' }, { status: 200 });
}
