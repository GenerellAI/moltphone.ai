/**
 * POST /api/agents/port-in — Register an agent with an existing MoltNumber
 *
 * Used for porting a number onto this carrier. The agent provides their
 * existing private key and MoltNumber. The carrier verifies:
 * 1. The private key → public key → MoltNumber derivation matches (self-certifying)
 * 2. The nation type is "open" (org/carrier numbers are not individually portable)
 * 3. The number is not already bound to this carrier
 * 4. The number is not already active on this carrier
 *
 * This is the receiving side of a port. The sending carrier has already
 * deactivated the agent and unbound the number from the registry.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { NUMBER_PORTABILITY } from '@/carrier.config';
import { issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON } from '@/lib/carrier-identity';
import { verifyMoltNumber, parseMoltNumber } from '@/lib/molt-number';
import { validateWebhookUrl, checkEndpointOwnership } from '@/lib/ssrf';
import { challengeEndpoint } from '@/lib/endpoint-challenge';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';
import { checkDelegation } from '@/lib/services/nation-delegation';
import { deductAgentCreationCredits, AGENT_CREATION_COST } from '@/lib/services/credits';
import { checkNationGraduation } from '@/lib/services/credits';
import { InboundPolicy } from '@prisma/client';
import { z } from 'zod';
import * as crypto from 'crypto';

const portInSchema = z.object({
  privateKey: z.string().min(1, 'Private key is required'),
  moltNumber: z.string().regex(/^[A-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/, 'Invalid MoltNumber format'),
  displayName: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  endpointUrl: z.string().url().optional(),
  callEnabled: z.boolean().optional().default(true),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).optional().default('public'),
  awayMessage: z.string().max(500).optional(),
  skills: z.array(z.string()).optional().default(['call', 'text']),
});

export async function POST(req: NextRequest) {
  if (!NUMBER_PORTABILITY) {
    return NextResponse.json({ error: 'Number portability is not enabled on this carrier' }, { status: 403 });
  }

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const userId = session.user.id;

  try {
    const body = await req.json();
    const data = portInSchema.parse(body);

    // Step 1: Derive the public key from the private key
    let publicKey: string;
    try {
      const privateKeyDer = Buffer.from(data.privateKey, 'base64url');
      const keyObj = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
      const pubKeyDer = crypto.createPublicKey(keyObj).export({ type: 'spki', format: 'der' });
      publicKey = Buffer.from(pubKeyDer).toString('base64url');
    } catch {
      return NextResponse.json({ error: 'Invalid private key. Expected base64url-encoded PKCS#8 DER Ed25519 key.' }, { status: 400 });
    }

    // Step 2: Verify the MoltNumber was derived from this public key (self-certifying check)
    if (!verifyMoltNumber(data.moltNumber, publicKey)) {
      return NextResponse.json({
        error: 'MoltNumber does not match the provided key. Self-certifying verification failed.',
      }, { status: 400 });
    }

    // Step 3: Parse the nation code from the MoltNumber
    const parsed = parseMoltNumber(data.moltNumber);
    if (!parsed) return NextResponse.json({ error: 'Invalid MoltNumber format' }, { status: 400 });
    const nationCode = parsed.nation;

    // Step 4: Verify the nation exists and is open-type
    const nation = await prisma.nation.findUnique({ where: { code: nationCode } });
    if (!nation) return NextResponse.json({ error: `Nation "${nationCode}" not found on this carrier` }, { status: 404 });
    if (!nation.isActive) return NextResponse.json({ error: 'Nation has been deactivated' }, { status: 403 });

    if (nation.type === 'carrier') {
      return NextResponse.json({ error: 'Carrier nation numbers are non-portable and cannot be ported in' }, { status: 403 });
    }
    if (nation.type === 'org') {
      // Org nations require delegation — check if this carrier has a delegation
      const delegationCheck = await checkDelegation(nationCode);
      if (!delegationCheck.ok) {
        return NextResponse.json({ error: `Org nation port-in requires carrier delegation: ${delegationCheck.reason}` }, { status: 403 });
      }
    }

    // Step 5: Check the number isn't already active on this carrier
    const existing = await prisma.agent.findFirst({
      where: { moltNumber: data.moltNumber, isActive: true },
    });
    if (existing) {
      return NextResponse.json({ error: 'This MoltNumber is already active on this carrier' }, { status: 409 });
    }

    // Step 6: Validate endpoint URL if provided
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) return NextResponse.json({ error: `Invalid endpoint URL: ${check.reason}` }, { status: 400 });
      const ownership = await checkEndpointOwnership(data.endpointUrl, userId);
      if (!ownership.ok) return NextResponse.json({ error: ownership.reason }, { status: 409 });
      const echo = await challengeEndpoint(data.endpointUrl);
      if (!echo.ok) return NextResponse.json({ error: `Endpoint verification failed: ${echo.reason}` }, { status: 422 });
    }

    // Step 7: Create the agent with the existing key and MoltNumber
    const agent = await prisma.agent.create({
      data: {
        moltNumber: data.moltNumber,
        nationCode,
        ownerId: userId,
        displayName: data.displayName,
        description: data.description,
        endpointUrl: data.endpointUrl,
        callEnabled: data.callEnabled,
        inboundPolicy: data.inboundPolicy as InboundPolicy,
        awayMessage: data.awayMessage,
        publicKey,
        skills: data.skills,
      },
      include: {
        nation: { select: { code: true, displayName: true, badge: true } },
        owner: { select: { id: true, name: true } },
      },
    });

    // Step 8: Issue registration certificate
    const registrationCert = issueRegistrationCertificate({
      moltNumber: data.moltNumber,
      agentPublicKey: publicKey,
      nationCode,
    });

    // Step 9: Deduct agent creation credits
    const deduction = await deductAgentCreationCredits(userId, data.moltNumber);
    if (!deduction.ok) {
      await prisma.agent.update({ where: { id: agent.id }, data: { isActive: false } });
      return NextResponse.json(
        { error: `Insufficient credits. Agent creation costs ${AGENT_CREATION_COST} credits.` },
        { status: 402 },
      );
    }

    // Step 10: Check nation graduation
    await checkNationGraduation(nationCode).catch(() => {/* non-critical */});

    // Step 11: Bind the number in the registry (to this carrier)
    bindNumber({ moltNumber: data.moltNumber, carrierDomain: getCarrierDomain(), nationCode }).catch(() => {/* non-critical */});

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { endpointUrl: _eu, publicKey: _pk, ...moltPage } = agent;

    return NextResponse.json({
      ...moltPage,
      portedIn: true,
      registrationCertificate: registrationCertToJSON(registrationCert),
      carrierCertificate: getCarrierCertificateJSON(),
      note: 'Number successfully ported in. Your existing private key remains valid.',
    }, { status: 201 });

  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('[POST /api/agents/port-in] Internal error:', e);
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: `Internal error: ${message}` }, { status: 500 });
  }
}
