/**
 * GET /call/:moltNumber/agent.json
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
import { isNonceReplay } from '@/lib/nonce';
import { moltErrorResponse } from '@/lib/errors';
import { issueRegistrationCertificate, registrationCertToJSON } from '@/lib/carrier-identity';
import {
  MOLT_AUTH_REQUIRED,
  MOLT_POLICY_DENIED,
  MOLT_NOT_FOUND,
} from '@moltprotocol/core';
import type { XMoltExtension } from '@moltprotocol/core';
import { callUrl } from '@/lib/call-url';
import { getActiveDelegation, delegationCertToJSON } from '@/lib/services/nation-delegation';

const CARRIER_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function GET(req: NextRequest, { params }: { params: Promise<{ moltNumber: string }> }) {
  const { moltNumber } = await params;
  const url = new URL(req.url);

  const agent = await prisma.agent.findUnique({
    where: { moltNumber, isActive: true },
    include: { nation: { select: { type: true, publicKey: true } } },
  });
  if (!agent) return moltErrorResponse(MOLT_NOT_FOUND, 'Agent not found', { molt_number: moltNumber });

  // Access control for non-public agents
  if (agent.inboundPolicy !== 'public') {
    const callerHeader = req.headers.get('x-molt-caller');
    const timestamp = req.headers.get('x-molt-timestamp');
    const nonce = req.headers.get('x-molt-nonce');
    const signature = req.headers.get('x-molt-signature');

    if (!callerHeader || !timestamp || !nonce || !signature) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller authentication required');
    }

    const callerAgent = await prisma.agent.findFirst({ where: { moltNumber: callerHeader, isActive: true } });
    if (!callerAgent?.publicKey) {
      return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Caller not found or has no public key');
    }

    const nonceKey = `${callerHeader}:${nonce}`;
    if (await isNonceReplay(nonceKey)) return moltErrorResponse(MOLT_AUTH_REQUIRED, 'Nonce replay detected');

    const result = verifySignature({
      method: 'GET',
      path: url.pathname,
      callerAgentId: callerHeader,
      targetAgentId: moltNumber,
      body: '',
      publicKey: callerAgent.publicKey,
      timestamp,
      nonce,
      signature,
    });
    if (!result.valid) return moltErrorResponse(MOLT_AUTH_REQUIRED, `Signature invalid: ${result.reason}`);

    if (agent.inboundPolicy === 'allowlist') {
      if (!agent.allowlistAgentIds.includes(callerAgent.id)) {
        return moltErrorResponse(MOLT_POLICY_DENIED, 'Caller not in allowlist');
      }
    }
  }

  const online = isOnline(agent.lastSeenAt);
  const taskSendUrl = callUrl(moltNumber, '/tasks/send');
  const lexiconUrl = callUrl(moltNumber, '/lexicon');

  const xMolt: XMoltExtension = {
    molt_number: moltNumber,
    nation: agent.nationCode,
    nation_type: (agent.nation?.type as 'carrier' | 'org' | 'open') ?? 'open',
    public_key: agent.publicKey ?? '',
    inbound_policy: agent.inboundPolicy as 'public' | 'registered_only' | 'allowlist',
    timestamp_window_seconds: 300,
    direct_connection_policy: agent.directConnectionPolicy,
    lexicon_url: lexiconUrl,
    // Registration certificate — proves this carrier registered this agent (offline-verifiable)
    registration_certificate: agent.publicKey ? registrationCertToJSON(
      issueRegistrationCertificate({
        moltNumber,
        agentPublicKey: agent.publicKey!,
        nationCode: agent.nationCode,
      }),
    ) : undefined,
    carrier_certificate_url: `${CARRIER_URL}/.well-known/molt-carrier.json`,
    // Previous numbers for identity continuity (porting / key rotation)
    previous_numbers: agent.previousNumbers?.length ? agent.previousNumbers : undefined,
  };

  // For org/carrier nations, attach the delegation certificate if one exists
  const nationType = agent.nation?.type;
  if ((nationType === 'org' || nationType === 'carrier') && agent.nation?.publicKey) {
    const delegation = await getActiveDelegation(agent.nationCode);
    if (delegation) {
      xMolt.delegation_certificate = delegationCertToJSON(delegation);
    }
  }

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
      streaming: true,
      pushNotifications: !!agent.pushEndpointUrl,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text', 'data', 'file'],
    defaultOutputModes: ['text', 'data', 'file'],
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
