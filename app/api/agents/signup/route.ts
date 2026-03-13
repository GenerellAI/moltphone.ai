/**
 * POST /api/agents/signup — Agent self-signup (no auth required).
 *
 * MoltBook-style hybrid flow:
 * 1. Agent calls this endpoint with its details
 * 2. Gets back a MoltSIM + a claim link to send to its human owner
 * 3. Agent is created in "unclaimed" state (limited: can receive tasks but not call out)
 * 4. Human visits claim link, logs in, verifies ownership
 * 5. Agent is fully activated under the human's account
 *
 * Unclaimed agents auto-expire after 7 days.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateMoltNumber } from '@/lib/molt-number';
import { generateKeyPair } from '@/lib/ed25519';
import { validateWebhookUrl, checkEndpointOwnership } from '@/lib/ssrf';
import { challengeEndpoint } from '@/lib/endpoint-challenge';
import { requireHttps } from '@/lib/require-https';
import { issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON, getCarrierPublicKey } from '@/lib/carrier-identity';
import { CALL_BASE_URL, callUrl } from '@/lib/call-url';
import { rateLimit } from '@/lib/rate-limit';
import { generateSecret } from '@/lib/secrets';
import { z } from 'zod';
import { InboundPolicy } from '@prisma/client';
import { checkNationGraduation } from '@/lib/services/credits';
import { bindNumber, getCarrierDomain } from '@/lib/services/registry';

const CLAIM_EXPIRY_DAYS = 7;

const signupSchema = z.object({
  nationCode: z.string().regex(/^[A-Z]{4}$/),
  displayName: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  endpointUrl: z.string().url().optional().nullable(),
  inboundPolicy: z.enum(['public', 'registered_only', 'allowlist']).default('public'),
  skills: z.array(z.string()).default(['call', 'text']),
});

export async function POST(req: NextRequest) {
  // Private key in response — require HTTPS
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  // Rate limit: 3 self-signups per hour per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rl = await rateLimit(`agent-signup:${ip}`, { maxRequests: 3, windowMs: 60 * 60 * 1000 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many signup attempts. Try again later.' },
      { status: 429 },
    );
  }

  try {
    const body = await req.json();
    const data = signupSchema.parse(body);

    // Verify nation exists and is eligible for self-signup.
    // Nation type gates:
    //   carrier → rejected (carrier nations only allow the carrier owner to register)
    //   org → requires valid delegation certificate for this carrier
    //   open → allowed if public, rejected if private
    const nation = await prisma.nation.findUnique({ where: { code: data.nationCode } });
    if (!nation) {
      return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
    }
    if (!nation.isActive) {
      return NextResponse.json(
        { error: 'This nation has been deactivated' },
        { status: 403 },
      );
    }

    // Carrier nations cannot accept self-signups
    if (nation.type === 'carrier') {
      return NextResponse.json(
        { error: 'Carrier nations do not accept self-signup. Ask the carrier to register your agent.' },
        { status: 403 },
      );
    }

    // Org nations: allow self-signup but agent is INERT until org owner approves.
    // The agent gets its MoltSIM immediately (MoltNumbers are precious — we never
    // generate a keypair and throw the private key away). Capabilities are restricted
    // server-side by callEnabled=false, not by withholding credentials.
    const isOrgPending = nation.type === 'org';

    // Open nations must be public for self-signup
    if (nation.type === 'open' && !nation.isPublic) {
      return NextResponse.json(
        { error: 'This nation is restricted. Ask the nation owner to register your agent.' },
        { status: 403 },
      );
    }

    // Private org nations still accept self-signup (agents pend approval)
    // but if the org has a member allowlist, skip it — approval flow handles access
    // (no delegation certificate needed for the pending flow)

    // Validate endpoint URL if provided
    if (data.endpointUrl) {
      const check = await validateWebhookUrl(data.endpointUrl);
      if (!check.ok) {
        return NextResponse.json({ error: `Invalid endpoint URL: ${check.reason}` }, { status: 400 });
      }
      const ownership = await checkEndpointOwnership(data.endpointUrl, null);
      if (!ownership.ok) {
        return NextResponse.json({ error: ownership.reason }, { status: 409 });
      }
      const echo = await challengeEndpoint(data.endpointUrl);
      if (!echo.ok) {
        return NextResponse.json({ error: `Endpoint verification failed: ${echo.reason}` }, { status: 422 });
      }
    }

    // Generate keypair — MoltNumber derived from public key
    const keyPair = generateKeyPair();
    const moltNumber = generateMoltNumber(data.nationCode, keyPair.publicKey);

    // Collision check (astronomically unlikely)
    const exists = await prisma.agent.findUnique({ where: { moltNumber } });
    if (exists) {
      return NextResponse.json({ error: 'MoltNumber collision — please retry' }, { status: 409 });
    }

    // Generate claim token
    const claimToken = generateSecret(32);
    const claimExpiresAt = new Date(Date.now() + CLAIM_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    // Create unclaimed agent (ownerId = null, callEnabled = false until claimed)
    const agent = await prisma.agent.create({
      data: {
        moltNumber,
        nationCode: data.nationCode,
        // ownerId left undefined = unclaimed
        displayName: data.displayName,
        description: data.description,
        endpointUrl: data.endpointUrl,
        callEnabled: false, // can't call out until claimed
        inboundPolicy: data.inboundPolicy as InboundPolicy,
        publicKey: keyPair.publicKey,
        skills: data.skills,
        claimToken,
        claimExpiresAt,
      },
      select: {
        id: true,
        moltNumber: true,
        nationCode: true,
        displayName: true,
        description: true,
        skills: true,
        claimExpiresAt: true,
        nation: { select: { code: true, displayName: true, badge: true } },
      },
    });

    // Check if this agent graduates the nation from provisional status
    await checkNationGraduation(data.nationCode).catch(() => {/* non-critical */});

    // Register the number with the MoltNumber registry (best-effort)
    bindNumber({ moltNumber, carrierDomain: getCarrierDomain(), nationCode: data.nationCode }).catch(() => {/* non-critical */});

    // Issue registration certificate
    const registrationCert = issueRegistrationCertificate({
      moltNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: data.nationCode,
    });

    // Build the claim URL
    const baseUrl = process.env.NEXTAUTH_URL || 'https://moltphone.ai';
    const claimUrl = `${baseUrl}/claim/${claimToken}`;

    // Build full MoltSIM profile
    const slug = moltNumber;
    const moltsim = {
      version: '1',
      carrier: 'moltphone.ai',
      agent_id: agent.id,
      molt_number: moltNumber,
      nation_type: nation.type as 'carrier' | 'org' | 'open',
      carrier_call_base: CALL_BASE_URL,
      inbox_url: callUrl(slug, '/tasks'),
      task_reply_url: callUrl(slug, '/tasks/:id/reply'),
      task_cancel_url: callUrl(slug, '/tasks/:id/cancel'),
      presence_url: callUrl(slug, '/presence/heartbeat'),
      public_key: keyPair.publicKey,
      private_key: keyPair.privateKey,
      carrier_public_key: getCarrierPublicKey(),
      signature_algorithm: 'Ed25519',
      canonical_string: 'METHOD\nPATH\nCALLER_AGENT_ID\nTARGET_AGENT_ID\nTIMESTAMP\nNONCE\nBODY_SHA256_HEX',
      timestamp_window_seconds: 300,
      registration_certificate: registrationCertToJSON(registrationCert),
      carrier_certificate: getCarrierCertificateJSON(),
    };

    return NextResponse.json({
      agent: {
        id: agent.id,
        moltNumber: agent.moltNumber,
        nationCode: agent.nationCode,
        displayName: agent.displayName,
        description: agent.description,
        skills: agent.skills,
        nation: agent.nation,
        status: isOrgPending ? 'pending_org_approval' : 'unclaimed',
        claimExpiresAt: claimExpiresAt.toISOString(),
      },
      moltsim,
      claim: {
        url: claimUrl,
        expiresAt: claimExpiresAt.toISOString(),
        instructions: isOrgPending
          ? 'Send this claim link to your human owner. They must log in and claim before the expiry date. The nation owner must also approve the agent before it can operate.'
          : 'Send this claim link to your human owner. They must log in and verify ownership before the expiry date. Until claimed, this agent can receive tasks but cannot call out.',
      },
      registrationCertificate: registrationCertToJSON(registrationCert),
      ...(isOrgPending && {
        pendingApproval: {
          message: 'This agent has been registered on an org nation and requires two steps: (1) the human owner claims via the claim link, and (2) the nation owner approves. The MoltSIM is issued immediately — capabilities are restricted server-side until both steps are complete.',
          nationCode: data.nationCode,
          nationDisplayName: nation.displayName,
        },
      }),
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.issues }, { status: 400 });
    }
    console.error('[POST /api/agents/signup]', e);
    const message = e instanceof Error ? e.message : 'Internal error';
    return NextResponse.json({ error: `Internal error: ${message}` }, { status: 500 });
  }
}
