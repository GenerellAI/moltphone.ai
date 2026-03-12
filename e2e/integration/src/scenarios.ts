/**
 * E2E Integration Test Scenarios
 *
 * Each scenario is a self-contained test that exercises one aspect of
 * the MoltPhone carrier. Scenarios are run sequentially and share the
 * same TestContext (agents, deliveries, carrier URL).
 *
 * Conventions:
 * - Each scenario returns a ScenarioResult.
 * - Deliveries are cleared between scenarios.
 * - Assertions throw on failure — the runner catches and records.
 */

import type { TestContext, ScenarioResult, WebhookDelivery } from './types';
import { getDeliveries, clearDeliveries, setResponseHandler, clearResponseHandlers } from './webhook-server';

// ── Helpers ──────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Wait `ms` milliseconds. */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Wait for a delivery to arrive at a specific agent within a timeout. */
async function waitForDelivery(
  agentName: string,
  timeoutMs = 10_000,
  intervalMs = 200,
): Promise<WebhookDelivery> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const d = getDeliveries().find(d => d.agentName === agentName);
    if (d) return d;
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for delivery to ${agentName} (${timeoutMs}ms)`);
}

/** Count deliveries to a specific agent. */
function deliveriesTo(agentName: string): WebhookDelivery[] {
  return getDeliveries().filter(d => d.agentName === agentName);
}

// ── Scenario type ────────────────────────────────────────

interface Scenario {
  name: string;
  run: (ctx: TestContext) => Promise<void>;
}

// ── Scenarios ────────────────────────────────────────────

const scenarios: Scenario[] = [
  // 1. All agents provisioned
  {
    name: '01 — All 6 agents created and provisioned',
    async run(ctx) {
      assert(ctx.agents.size === 6, `Expected 6 agents, got ${ctx.agents.size}`);
      for (const name of ['Alpha', 'Beta', 'Charlie', 'Delta', 'Echo', 'Foxtrot']) {
        const a = ctx.agents.get(name);
        assert(!!a, `Agent ${name} not found`);
        assert(!!a!.moltNumber, `${name} has no moltNumber`);
        assert(!!a!.moltsim.private_key, `${name} has no privateKey in MoltSIM`);
        assert(!!a!.moltsim.public_key, `${name} has no publicKey in MoltSIM`);
      }
    },
  },

  // 2. Presence heartbeat
  {
    name: '02 — Online agents can send heartbeats',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const result = await alpha.client.heartbeat();
      assert(result.ok, `Heartbeat failed: status ${result.status}`);
      assert(!!result.lastSeenAt, 'No lastSeenAt in heartbeat response');
    },
  },

  // 3. Alpha texts Beta → webhook receives delivery
  {
    name: '03 — Alpha texts Beta → webhook receives delivery',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const beta = ctx.agents.get('Beta')!;

      const result = await alpha.client.text(beta.moltNumber, 'Hello Beta!');

      // The carrier should have forwarded to Beta's webhook
      // and returned a success response
      assert(result.ok, `Text send failed: ${result.status} ${JSON.stringify(result.body)}`);

      // Check webhook delivery
      const delivery = await waitForDelivery('Beta');
      assert(delivery.parsed !== null, 'Delivery body is not valid JSON');

      // Check the message content
      const parts = (delivery.parsed as any)?.params?.message?.parts
        ?? (delivery.parsed as any)?.message?.parts;
      assert(Array.isArray(parts), 'No message parts in delivery');
      const textPart = parts.find((p: any) => p.type === 'text');
      assert(textPart?.text === 'Hello Beta!', `Expected "Hello Beta!", got "${textPart?.text}"`);

      // Check carrier identity headers are present
      assert(!!delivery.headers['x-molt-identity'], 'Missing X-Molt-Identity header');
      assert(!!delivery.headers['x-molt-identity-carrier'], 'Missing X-Molt-Identity-Carrier header');
      assert(!!delivery.headers['x-molt-identity-attest'], 'Missing X-Molt-Identity-Attest header');
    },
  },

  // 4. MoltUA carrier identity verification
  {
    name: '04 — Carrier identity (STIR/SHAKEN) is verified on webhook',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const beta = ctx.agents.get('Beta')!;

      await alpha.client.text(beta.moltNumber, 'Verify me!');
      const delivery = await waitForDelivery('Beta');

      // The webhook server runs MoltUA L1 verification
      // In non-strict mode, it records the result even if verification fails
      // With carrier_public_key set, it should verify
      if (beta.moltsim.carrier_public_key) {
        assert(delivery.carrierVerified === true, 'Carrier identity NOT verified — MoltUA L1 failed');
        assert(delivery.attestation === 'A' || delivery.attestation === 'B',
          `Expected attestation A or B, got "${delivery.attestation}"`);
      } else {
        console.log('    ⚠ Skipping strict verification — no carrier public key');
      }
    },
  },

  // 5. Alpha calls Beta → multi-turn conversation
  {
    name: '05 — Alpha calls Beta → multi-turn (working status)',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const beta = ctx.agents.get('Beta')!;

      // Set up Beta to respond with "working" status for calls
      setResponseHandler('Beta', (parsed) => {
        const taskId = (parsed as any)?.params?.id ?? 'unknown';
        return {
          jsonrpc: '2.0',
          result: {
            id: taskId,
            status: { state: 'working' },
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: '[Beta] I am working on your call.' }],
            },
          },
        };
      });

      const result = await alpha.client.call(beta.moltNumber, 'Start a call with Beta');

      assert(result.ok, `Call failed: ${result.status} ${JSON.stringify(result.body)}`);

      // For calls (intent=call), the carrier returns 'working' when webhook succeeds
      const status = (result.body as any)?.status;
      assertEqual(status, 'working', 'Task status');

      // Check the echo response came through
      const msgParts = (result.body as any)?.message?.parts;
      assert(Array.isArray(msgParts), 'No message parts in response');
    },
  },

  // 6. Alpha texts Charlie (offline) → forwarded to Delta
  {
    name: '06 — Forwarding: Alpha → Charlie (offline) → forwarded to Delta',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const charlie = ctx.agents.get('Charlie')!;

      // Charlie is offline with forwarding to Delta when_offline
      const result = await alpha.client.text(charlie.moltNumber, 'Hello Charlie-via-Delta!');

      // The task should be forwarded to Delta's webhook
      assert(result.ok, `Text to Charlie failed: ${result.status} ${JSON.stringify(result.body)}`);

      // Delta should receive the delivery (since Charlie is offline + forwarding enabled)
      const delivery = await waitForDelivery('Delta', 10_000);
      assert(delivery.parsed !== null, 'No delivery to Delta');

      // Charlie should NOT receive a delivery (offline, no heartbeat)
      const charlieDeliveries = deliveriesTo('Charlie');
      assertEqual(charlieDeliveries.length, 0, 'Charlie delivery count');
    },
  },

  // 7. Alpha texts Echo (DND) → queued + away message
  {
    name: '07 — DND: Alpha → Echo → queued with away message (487)',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const echo = ctx.agents.get('Echo')!;

      const result = await alpha.client.text(echo.moltNumber, 'Hello Echo!');

      // DND maps to HTTP 503; Molt error code 487 is in the JSON body
      assertEqual(result.status, 503, 'HTTP status');
      assert(!result.ok, 'Should not be ok (503/DND)');

      // Response should include Molt error code 487 (MOLT_DND), away_message and task_id
      const body = result.body as any;
      assertEqual(body?.error?.code, 487, 'Molt error code (DND)');
      assert(!!body?.error?.data?.task_id, 'No task_id in DND response');
      assert(!!body?.error?.data?.away_message, 'No away_message in DND response');

      // Echo's webhook should NOT receive the delivery (DND queues it)
      await sleep(500);
      const echoDeliveries = deliveriesTo('Echo');
      assertEqual(echoDeliveries.length, 0, 'Echo delivery count');
    },
  },

  // 8. Alpha texts Foxtrot → allowed (on allowlist)
  {
    name: '08 — Allowlist: Alpha → Foxtrot → allowed',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const foxtrot = ctx.agents.get('Foxtrot')!;

      const result = await alpha.client.text(foxtrot.moltNumber, 'Hello Foxtrot from Alpha!');

      assert(result.ok, `Text to Foxtrot failed: ${result.status} ${JSON.stringify(result.body)}`);

      // Foxtrot should receive the delivery
      const delivery = await waitForDelivery('Foxtrot');
      assert(delivery.parsed !== null, 'No delivery to Foxtrot');
    },
  },

  // 9. Beta texts Foxtrot → denied (not on allowlist)
  {
    name: '09 — Allowlist: Beta → Foxtrot → denied (403)',
    async run(ctx) {
      const beta = ctx.agents.get('Beta')!;
      const foxtrot = ctx.agents.get('Foxtrot')!;

      const result = await beta.client.text(foxtrot.moltNumber, 'Hello Foxtrot from Beta!');

      // Should be denied — Beta is not on Foxtrot's allowlist
      assertEqual(result.status, 403, 'HTTP status');
      assert(!result.ok, 'Should not be ok (403)');

      // Foxtrot should NOT receive a delivery
      await sleep(300);
      const foxtrotDeliveries = deliveriesTo('Foxtrot');
      assertEqual(foxtrotDeliveries.length, 0, 'Foxtrot delivery count');
    },
  },

  // 10. Echo polls inbox → finds queued task
  {
    name: '10 — Inbox: Echo polls inbox → finds queued DND task',
    async run(ctx) {
      const echo = ctx.agents.get('Echo')!;

      // Echo polls its inbox — should find the task queued in scenario 07
      const inbox = await echo.client.pollInbox();

      assert(inbox.ok, `Inbox poll failed: ${inbox.status}`);
      assert(inbox.tasks.length > 0, 'Inbox is empty — expected at least 1 queued task');

      // The task should have a message from Alpha
      const task = inbox.tasks[0];
      assert(!!task.taskId || !!task.messages, 'Task missing expected fields');
    },
  },

  // 11. Agent Card discovery
  {
    name: '11 — Agent Card at /call/:number/agent.json',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;

      const res = await fetch(`${ctx.carrierUrl}/call/${alpha.moltNumber}/agent.json`);
      assert(res.ok, `Agent Card fetch failed: ${res.status}`);

      const card = await res.json() as Record<string, any>;

      // Standard A2A fields
      assert(!!card.name, 'Agent Card missing name');
      assert(!!card.url, 'Agent Card missing url');
      assert(!!card.skills, 'Agent Card missing skills');

      // x-molt extensions
      assert(!!card['x-molt'], 'Agent Card missing x-molt extensions');
      assertEqual(card['x-molt'].molt_number, alpha.moltNumber, 'Agent Card MoltNumber');
      assertEqual(card['x-molt'].nation, 'TEST', 'Agent Card nation');
      assert(!!card['x-molt'].public_key, 'Agent Card missing public key');
      assert(!!card['x-molt'].registration_certificate, 'Agent Card missing registration certificate');
    },
  },

  // 12. Task cancellation
  {
    name: '12 — Alpha sends task then cancels it',
    async run(ctx) {
      const alpha = ctx.agents.get('Alpha')!;
      const beta = ctx.agents.get('Beta')!;

      // Set Beta to respond with 'working' status
      setResponseHandler('Beta', (parsed) => {
        const taskId = (parsed as any)?.params?.id ?? 'unknown';
        return {
          jsonrpc: '2.0',
          result: {
            id: taskId,
            status: { state: 'working' },
            message: {
              role: 'agent',
              parts: [{ type: 'text', text: '[Beta] Working...' }],
            },
          },
        };
      });

      const sendResult = await alpha.client.call(beta.moltNumber, 'Task to cancel');
      assert(sendResult.ok, `Call failed: ${sendResult.status}`);

      // Extract the task ID from the response
      const taskId = (sendResult.body as any)?.id;
      assert(!!taskId, 'No task ID in send response');

      // Now cancel it — cancel endpoint uses the target agent's moltNumber in the path
      // The MoltClient.cancel sends to its own call endpoint
      // But the carrier's cancel route is /call/:moltNumber/tasks/:taskId/cancel
      // where :moltNumber is the callee (Beta), and the caller (Alpha) authenticates.
      // MoltClient.cancel is designed for the callee to cancel their own tasks.
      // For the caller to cancel, we need to call Beta's cancel endpoint with Alpha's signature.
      const cancelUrl = `${ctx.carrierUrl}/call/${beta.moltNumber}/tasks/${taskId}/cancel`;

      // Use the MoltClient's internal signing to create headers
      // Actually, let's use Alpha's client to construct a signed cancel
      // The cancel method on MoltClient assumes it's the callee cancelling its own task.
      // For cross-agent cancel, we build the request manually.
      const crypto = await import('crypto');
      const { signRequest } = await import('@moltprotocol/core');

      const body = JSON.stringify({
        jsonrpc: '2.0',
        method: 'tasks/cancel',
        params: { id: taskId },
      });

      const headers = signRequest({
        method: 'POST',
        path: `/call/${beta.moltNumber}/tasks/${taskId}/cancel`,
        callerAgentId: alpha.moltNumber,
        targetAgentId: beta.moltNumber,
        body,
        privateKey: alpha.moltsim.private_key!,
      });

      const cancelRes = await fetch(cancelUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body,
      });

      // Read body once to avoid "Body has already been read" error
      const cancelText = await cancelRes.text();
      assert(cancelRes.ok, `Cancel failed: ${cancelRes.status} ${cancelText}`);

      const cancelBody = JSON.parse(cancelText);
      assertEqual(cancelBody.status, 'canceled', 'Cancel response status');
    },
  },
];

// ── Runner ───────────────────────────────────────────────

export async function runScenarios(ctx: TestContext): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];

  console.log('\n=== SCENARIOS ===\n');

  for (const scenario of scenarios) {
    // Clear state between scenarios
    clearDeliveries();
    clearResponseHandlers();

    const start = Date.now();
    process.stdout.write(`  ${scenario.name} ... `);

    try {
      await scenario.run(ctx);
      const durationMs = Date.now() - start;
      results.push({ name: scenario.name, status: 'pass', durationMs });
      console.log(`PASS (${durationMs}ms)`);
    } catch (err) {
      const durationMs = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name: scenario.name, status: 'fail', durationMs, error: message });
      console.log(`FAIL (${durationMs}ms)`);
      console.log(`    → ${message}`);
    }
  }

  return results;
}
