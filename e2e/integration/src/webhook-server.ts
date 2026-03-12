/**
 * Webhook server — hosts one endpoint per agent, receives carrier deliveries.
 *
 * Each agent's webhook is at: http://harness:4000/webhook/<agentName>
 *
 * On delivery:
 * 1. Verify carrier identity (MoltUA Level 1) if the agent has a MoltSIM
 * 2. Record the delivery for later assertion
 * 3. Respond with an appropriate A2A JSON-RPC response
 *
 * Also handles the endpoint echo challenge (molt/verify).
 */

import http from 'node:http';
import { verifyInboundDelivery, type InboundDeliveryHeaders } from '@moltprotocol/core';
import type { WebhookDelivery, ProvisionedAgent } from './types';

// ── State ────────────────────────────────────────────────

/** All received deliveries, newest last. */
const deliveries: WebhookDelivery[] = [];

/** Map of agent name → ProvisionedAgent (set after setup). */
let agentMap: Map<string, ProvisionedAgent> = new Map();

/** Custom response handlers per agent name. */
const responseHandlers: Map<string, (parsed: Record<string, unknown>) => Record<string, unknown> | null> = new Map();

export function getDeliveries(): WebhookDelivery[] {
  return deliveries;
}

export function clearDeliveries(): void {
  deliveries.length = 0;
}

export function setAgents(agents: Map<string, ProvisionedAgent>): void {
  agentMap = agents;
}

export function setResponseHandler(
  agentName: string,
  handler: (parsed: Record<string, unknown>) => Record<string, unknown> | null,
): void {
  responseHandlers.set(agentName, handler);
}

export function clearResponseHandlers(): void {
  responseHandlers.clear();
}

// ── Server ───────────────────────────────────────────────

export function createWebhookServer(port: number): http.Server {
  const server = http.createServer(async (req, res) => {
    // Collect body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf-8');

    // Parse URL: /webhook/<agentName>
    const match = req.url?.match(/^\/webhook\/([^/]+)/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const agentName = match[1];
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      // non-JSON body
    }

    // ── Handle endpoint echo challenge ──
    if (parsed && (parsed as any).method === 'molt/verify') {
      const challenge = (parsed as any).params?.challenge;
      const id = (parsed as any).id;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        result: { challenge },
        id,
      }));
      return;
    }

    // ── MoltUA Level 1 verification ──
    const agent = agentMap.get(agentName);
    let carrierVerified = false;
    let attestation: string | undefined;

    if (agent) {
      const hdrs: InboundDeliveryHeaders = {
        'x-molt-identity': req.headers['x-molt-identity'] as string ?? null,
        'x-molt-identity-carrier': req.headers['x-molt-identity-carrier'] as string ?? null,
        'x-molt-identity-attest': req.headers['x-molt-identity-attest'] as string ?? null,
        'x-molt-identity-timestamp': req.headers['x-molt-identity-timestamp'] as string ?? null,
        'x-molt-target': req.headers['x-molt-target'] as string ?? null,
      };

      const origNumber = req.headers['x-molt-caller'] as string ?? 'anonymous';
      const result = verifyInboundDelivery(
        {
          moltNumber: agent.moltNumber,
          privateKey: agent.moltsim.private_key!,
          publicKey: agent.moltsim.public_key,
          carrierPublicKey: agent.moltsim.carrier_public_key,
          carrierDomain: agent.moltsim.carrier,
          timestampWindowSeconds: agent.moltsim.timestamp_window_seconds,
        },
        hdrs,
        body,
        { strictMode: false, origNumber }, // non-strict: dev mode may not always sign
      );

      carrierVerified = result.carrierVerified;
      attestation = result.attestation;
    }

    // ── Record delivery ──
    const headerMap: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v === 'string') headerMap[k] = v;
    }

    deliveries.push({
      agentName,
      timestamp: Date.now(),
      method: req.method || 'POST',
      headers: headerMap,
      body,
      parsed,
      carrierVerified,
      attestation,
    });

    // ── Custom response handler ──
    const handler = responseHandlers.get(agentName);
    if (handler && parsed) {
      const customResp = handler(parsed);
      if (customResp) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(customResp));
        return;
      }
    }

    // ── Default: echo response ──
    const taskId = (parsed as any)?.params?.id ?? (parsed as any)?.id ?? 'unknown';
    const intent = (parsed as any)?.params?.metadata?.['molt.intent'] ?? 'text';
    const textParts = (parsed as any)?.params?.message?.parts
      ?.filter((p: any) => p.type === 'text')
      ?.map((p: any) => p.text) ?? [];

    const responseBody = JSON.stringify({
      jsonrpc: '2.0',
      result: {
        id: taskId,
        status: { state: intent === 'text' ? 'completed' : 'working' },
        message: {
          role: 'agent',
          parts: [{
            type: 'text',
            text: textParts.length
              ? `[${agentName}] Echo: ${textParts.join(' ')}`
              : `[${agentName}] Received task ${taskId}`,
          }],
        },
      },
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(responseBody);
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`  Webhook server listening on :${port}`);
  });

  return server;
}
