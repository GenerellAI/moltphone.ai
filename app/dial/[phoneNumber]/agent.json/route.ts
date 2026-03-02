/**
 * GET /dial/:phoneNumber/agent.json
 *
 * Agent Card — standard A2A discovery document with x-molt extensions.
 * Access-controlled by inbound policy:
 *   - public: anyone may fetch
 *   - registered_only / allowlist: requires Ed25519-authenticated caller
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { verifySignature } from '@/lib/ed25519';
import { moltErrorResponse } from '@/lib/errors';
import { getCarrierPublicKey, issueRegistrationCertificate, CARRIER_DOMAIN } from '@/lib/carrier-identity';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@/core/moltprotocol/src/errors';
import type { XMoltExtension } from '@/core/moltprotocol/src/types';
import { dialUrl } from '@/lib/dial-url';

const CARRIER_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function GET(req: NextRequest, { params }: { params: Promise<{ phoneNumber: string }> }) {
  const { phoneNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({ where: { phoneNumber, isActive: true } });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { phone_number: phoneNumber });

  // Access control for non-public agents
  if (agent.inboundPolicy !== 'public') {
    const callerHeader = req.headers.get('x-molt-caller');
    const timestamp = req.headers.get('x-molt-timestamp');
    const nonce = req.headers.get('x-molt-nonce');
    const signature = req.headers.get('x-molt-signature');

    if (!callerHeader || !timestamp || !nonce || !signature) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller authentication required');
    }

    const callerAgent = await prisma.agent.findFirst({ where: { phoneNumber: callerHeader, isActive: true } });
    if (!callerAgent?.publicKey) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller not found or has no public key');
    }

    const nonceKey = `${callerHeader}:${nonce}`;
    const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
    if (nonceUsed) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

    const result = verifySignature({
      method: 'GET',
      path: url.pathname,
      callerAgentId: callerHeader,
      targetAgentId: phoneNumber,
      body: '',
      publicKey: callerAgent.publicKey,
      timestamp,
      nonce,
      signature,
    });
    if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

    await prisma.nonceUsed.create({
      data: { nonce: nonceKey, expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
    });

    if (agent.inboundPolicy === 'allowlist') {
      if (!agent.allowlistAgentIds.includes(callerAgent.id)) {
        return moltErrorResponse(MOLT_POLICY_DENIED, 'Caller not in allowlist');
      }
    }
  }

  const online = isOnline(agent.lastSeenAt);
  const taskSendUrl = dialUrl(phoneNumber, '/tasks/send');

  const xMolt: XMoltExtension = {
    phone_number: phoneNumber,
    nation: agent.nationCode,
    public_key: agent.publicKey ?? '',
    timestamp_window_seconds: 300,
    direct_connection_policy: agent.directConnectionPolicy,
    // Registration certificate — proves this carrier registered this agent (offline-verifiable)
    registration_certificate: agent.publicKey ? (() => {
      const cert = issueRegistrationCertificate({
        phoneNumber,
        agentPublicKey: agent.publicKey!,
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
    })() : undefined,
  };

  const agentCard = {
    schema: 'https://moltprotocol.org/a2a/agent-card/v1',
    name: agent.displayName,
    description: agent.description ?? undefined,
    url: taskSendUrl,
    provider: {
      organization: 'MoltPhone',
      url: CARRIER_URL,
    },
    version: '1.0',
    capabilities: {
      streaming: false,
      pushNotifications: !!agent.pushEndpointUrl,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: agent.skills.map(name => ({ id: name, name })),
    authentication: {
      schemes: ['Ed25519'],
      required: agent.inboundPolicy !== 'public',
    },
    status: online ? 'online' : 'offline',
    degraded: agent.isDegraded || undefined,
    'x-molt': xMolt,
  };

  return NextResponse.json(agentCard, {
    headers: { 'Content-Type': 'application/json' },
  });
}
