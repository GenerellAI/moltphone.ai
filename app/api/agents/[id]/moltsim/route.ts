import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateKeyPair } from '@/lib/ed25519';
import { generateMoltNumber } from '@/lib/molt-number';
import { getCarrierPublicKey, issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON, CARRIER_DOMAIN } from '@/lib/carrier-identity';
import { requireHttps } from '@/lib/require-https';
import { CALL_BASE_URL, callUrl } from '@/lib/call-url';
import { bindNumber, unbindNumber, getCarrierDomain } from '@/lib/services/registry';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  // MoltSIM contains private key — require encrypted transport
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id },
    include: { nation: { select: { type: true } } },
  });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  
  // Rotate keypair — new key means new self-certifying MoltNumber.
  // This instantly revokes the old MoltSIM and old number.
  const keyPair = generateKeyPair();
  const newMoltNumber = generateMoltNumber(agent.nationCode, keyPair.publicKey);
  
  // Check for astronomically unlikely collision
  const exists = await prisma.agent.findFirst({ where: { moltNumber: newMoltNumber, id: { not: id } } });
  if (exists) return NextResponse.json({ error: 'MoltNumber collision — please retry' }, { status: 409 });
  
  // Track the old MoltNumber for identity continuity
  const previousNumbers = [...(agent.previousNumbers || [])];
  if (agent.moltNumber && !previousNumbers.includes(agent.moltNumber)) {
    previousNumbers.push(agent.moltNumber);
  }

  await prisma.agent.update({
    where: { id },
    data: { publicKey: keyPair.publicKey, moltNumber: newMoltNumber, previousNumbers },
  });
  
  const slug = newMoltNumber;
  const profile = {
    version: '1',
    carrier: CARRIER_DOMAIN,
    agent_id: agent.id,
    molt_number: newMoltNumber,
    nation_type: (agent.nation?.type as 'carrier' | 'org' | 'open') ?? 'open',
    // Outbound: base URL for calling other agents
    carrier_call_base: CALL_BASE_URL,
    // Inbound: URLs this agent uses to receive and manage tasks
    inbox_url: callUrl(slug, '/tasks'),
    task_reply_url: callUrl(slug, '/tasks/:id/reply'),
    task_cancel_url: callUrl(slug, '/tasks/:id/cancel'),
    presence_url: callUrl(slug, '/presence/heartbeat'),
    // Credentials — private key shown once; store securely
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    // Carrier identity — for verifying X-Molt-Identity on inbound deliveries (MoltUA Level 1)
    carrier_public_key: getCarrierPublicKey(),
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
    // Registration certificate — proves this agent was registered by this carrier
    registration_certificate: registrationCertToJSON(issueRegistrationCertificate({
      moltNumber: newMoltNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: agent.nationCode,
    })),
    // Carrier certificate — root authority's signature proving this carrier is authorized
    carrier_certificate: getCarrierCertificateJSON(),
  };
  
  // Update registry bindings (best-effort)
  unbindNumber(agent.moltNumber).catch(() => {/* non-critical */});
  bindNumber({ moltNumber: newMoltNumber, carrierDomain: getCarrierDomain(), nationCode: agent.nationCode }).catch(() => {/* non-critical */});

  return NextResponse.json({ profile, note: 'Private key shown once. Store securely.' }, { status: 200 });
}
