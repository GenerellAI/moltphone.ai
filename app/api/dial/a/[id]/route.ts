import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isOnline } from '@/lib/presence';
import { validateWebhookUrl } from '@/lib/ssrf';
import { z } from 'zod';

const RING_TIMEOUT_MS = parseInt(process.env.RING_TIMEOUT_MS || '5000', 10);
const MAX_FORWARD_HOPS = parseInt(process.env.MAX_FORWARD_HOPS || '3', 10);

const bodySchema = z.object({
  message: z.string().min(1),
  caller_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function attemptForwarding(
  agentId: string,
  hops: string[],
): Promise<{ finalAgentId: string; hops: string[] }> {
  if (hops.length >= MAX_FORWARD_HOPS) return { finalAgentId: agentId, hops };
  
  const agent = await prisma.agent.findUnique({ where: { id: agentId, isActive: true } });
  if (!agent?.callForwardingEnabled || !agent.forwardToAgentId) return { finalAgentId: agentId, hops };
  
  const online = isOnline(agent.lastSeenAt);
  const shouldForward = (() => {
    switch (agent.forwardCondition) {
      case 'always': return true;
      case 'when_offline': return !online;
      case 'when_busy': return false;
      case 'when_dnd': return agent.dndEnabled;
      default: return false;
    }
  })();
  
  if (!shouldForward) return { finalAgentId: agentId, hops };
  
  const newHops = [...hops, agentId];
  if (newHops.includes(agent.forwardToAgentId)) {
    return { finalAgentId: agentId, hops: newHops };
  }
  
  return attemptForwarding(agent.forwardToAgentId, newHops);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rawBody = await req.text();
  const agent = await prisma.agent.findUnique({ where: { id: params.id, isActive: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  
  const callerHeader = req.headers.get('x-moltphone-caller');
  
  if (agent.inboundPolicy !== 'public') {
    if (!callerHeader) return NextResponse.json({ error: 'Caller ID required', status_code: 403 }, { status: 403 });
    
    const callerAgent = await prisma.agent.findUnique({ where: { id: callerHeader, isActive: true } });
    if (!callerAgent) return NextResponse.json({ error: 'Caller not found' }, { status: 403 });
    
    const nonce = req.headers.get('x-moltphone-nonce') || '';
    const nonceKey = `${callerHeader}:${nonce}`;
    const nonceUsed = await prisma.nonceUsed.findUnique({ where: { nonce: nonceKey } });
    if (nonceUsed) return NextResponse.json({ error: 'Nonce replay detected' }, { status: 403 });
    
    if (agent.inboundPolicy === 'allowlist') {
      if (!agent.allowlistAgentIds.includes(callerHeader)) {
        return NextResponse.json({ error: 'Caller not in allowlist' }, { status: 403 });
      }
    }
    
    await prisma.nonceUsed.create({
      data: {
        nonce: nonceKey,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });
  }
  
  let parsedBody: { message: string; caller_id?: string; metadata?: Record<string, unknown> };
  try {
    parsedBody = bodySchema.parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  
  const forwardResult = await attemptForwarding(agent.id, []);
  const targetAgentId = forwardResult.finalAgentId;
  const forwardingHops = forwardResult.hops;
  const loopDetected = forwardResult.hops.length >= MAX_FORWARD_HOPS;
  
  const finalAgent = targetAgentId === agent.id ? agent : 
    (await prisma.agent.findUnique({ where: { id: targetAgentId, isActive: true } }) || agent);
  
  if (finalAgent.dndEnabled) {
    const call = await prisma.call.create({
      data: {
        calleeId: finalAgent.id,
        callerId: callerHeader || null,
        type: 'call',
        status: 'voicemail',
        forwardingHops,
        body: parsedBody.message,
        messages: { create: { role: 'user', content: parsedBody.message } },
        voicemails: {
          create: {
            agentId: finalAgent.id,
            fromNumber: callerHeader || null,
            body: parsedBody.message,
            greeting: finalAgent.voicemailGreeting || null,
          },
        },
      },
    });
    return NextResponse.json({
      status: 'voicemail',
      reason: 'dnd',
      call_id: call.id,
      greeting: finalAgent.voicemailGreeting || null,
    });
  }
  
  const activeCalls = await prisma.call.count({
    where: { calleeId: finalAgent.id, status: 'connected' },
  });
  if (activeCalls >= finalAgent.maxConcurrentCalls) {
    const call = await prisma.call.create({
      data: {
        calleeId: finalAgent.id,
        callerId: callerHeader || null,
        type: 'call',
        status: 'busy',
        forwardingHops,
        body: parsedBody.message,
        voicemails: {
          create: {
            agentId: finalAgent.id,
            fromNumber: callerHeader || null,
            body: parsedBody.message,
            greeting: finalAgent.voicemailGreeting || null,
          },
        },
      },
    });
    return NextResponse.json({ status: 'busy', call_id: call.id, greeting: finalAgent.voicemailGreeting || null });
  }
  
  const online = isOnline(finalAgent.lastSeenAt);
  
  if (finalAgent.endpointUrl && online) {
    // Runtime SSRF re-validation before forwarding (endpoint may have changed)
    const ssrfCheck = await validateWebhookUrl(finalAgent.endpointUrl);
    if (ssrfCheck.ok) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RING_TIMEOUT_MS);

      try {
        const response = await fetch(finalAgent.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-MoltPhone-Target': finalAgent.id },
          body: rawBody,
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (response.ok) {
          const call = await prisma.call.create({
            data: {
              calleeId: finalAgent.id,
              callerId: callerHeader || null,
              type: 'call',
              status: 'connected',
              forwardingHops,
              body: parsedBody.message,
              messages: { create: { role: 'user', content: parsedBody.message } },
            },
          });
          const responseBody = await response.text();
          await prisma.callMessage.create({ data: { callId: call.id, role: 'agent', content: responseBody } });
          return NextResponse.json({ status: 'connected', call_id: call.id, response: responseBody });
        }
      } catch {
        clearTimeout(timeout);
      }
    }
  }
  
  const callStatus: 'failed_forward' | 'missed' | 'voicemail' = loopDetected ? 'failed_forward' : (online ? 'missed' : 'voicemail');
  const call = await prisma.call.create({
    data: {
      calleeId: finalAgent.id,
      callerId: callerHeader || null,
      type: 'call',
      status: callStatus,
      forwardingHops,
      body: parsedBody.message,
      messages: { create: { role: 'user', content: parsedBody.message } },
      voicemails: {
        create: {
          agentId: finalAgent.id,
          fromNumber: callerHeader || null,
          body: parsedBody.message,
          greeting: finalAgent.voicemailGreeting || null,
        },
      },
    },
  });
  
  return NextResponse.json({
    status: callStatus,
    call_id: call.id,
    greeting: finalAgent.voicemailGreeting || null,
  });
}
