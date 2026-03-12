/**
 * E2E Integration Test — Orchestrator
 *
 * Entry point for the test harness container.
 *
 * Flow:
 * 1. Start webhook server on HARNESS_PORT (default 4000)
 * 2. Wait for the carrier to be healthy (poll /api/nations)
 * 3. Run setup() — register user, create nations + agents
 * 4. Wire webhook server to know about provisioned agents
 * 5. Run all scenarios sequentially
 * 6. Print report and exit with code 0 or 1
 *
 * Environment variables:
 *   CARRIER_URL   — e.g. http://carrier:3000 (default http://localhost:3000)
 *   HARNESS_PORT  — port for the webhook server (default 4000)
 *   HARNESS_HOST  — hostname of this container (default harness)
 */

import { createWebhookServer, setAgents, getDeliveries } from './webhook-server';
import { setup } from './setup';
import { runScenarios } from './scenarios';
import type { ScenarioResult } from './types';

// ── Config ───────────────────────────────────────────────

const CARRIER_URL = process.env.CARRIER_URL || 'http://localhost:3000';
const HARNESS_PORT = parseInt(process.env.HARNESS_PORT || '4000', 10);
const HARNESS_HOST = process.env.HARNESS_HOST || 'harness';
const HEALTH_TIMEOUT_MS = 120_000; // 2 minutes max for carrier to be ready
const HEALTH_INTERVAL_MS = 2_000;

// ── Health check ─────────────────────────────────────────

async function waitForCarrier(): Promise<void> {
  console.log(`\nWaiting for carrier at ${CARRIER_URL} ...`);
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${CARRIER_URL}/api/nations`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        console.log('  Carrier is ready.\n');
        return;
      }
      console.log(`  Health: ${res.status} — retrying...`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  Health: ${msg} — retrying...`);
    }
    await new Promise(r => setTimeout(r, HEALTH_INTERVAL_MS));
  }

  throw new Error(`Carrier not ready after ${HEALTH_TIMEOUT_MS / 1000}s`);
}

// ── Report ───────────────────────────────────────────────

function printReport(results: ScenarioResult[]): { passed: number; failed: number; skipped: number } {
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const skipped = results.filter(r => r.status === 'skip').length;
  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);

  console.log('\n═══════════════════════════════════════════');
  console.log('  E2E INTEGRATION TEST REPORT');
  console.log('═══════════════════════════════════════════\n');

  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '○';
    console.log(`  ${icon} ${r.name} (${r.durationMs}ms)`);
    if (r.error) {
      console.log(`    → ${r.error}`);
    }
  }

  console.log(`\n  Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
  console.log(`  Duration: ${(totalMs / 1000).toFixed(1)}s`);
  console.log('═══════════════════════════════════════════\n');

  return { passed, failed, skipped };
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('╔═══════════════════════════════════════════╗');
  console.log('║  MoltPhone E2E Integration Test Harness   ║');
  console.log('╚═══════════════════════════════════════════╝');
  console.log(`  Carrier:  ${CARRIER_URL}`);
  console.log(`  Harness:  ${HARNESS_HOST}:${HARNESS_PORT}`);

  // 1. Start webhook server
  const server = createWebhookServer(HARNESS_PORT);
  const harnessBaseUrl = `http://${HARNESS_HOST}:${HARNESS_PORT}`;

  try {
    // 2. Wait for carrier health
    await waitForCarrier();

    // 3. Setup: register user, create nations + agents
    const ctx = await setup(CARRIER_URL, harnessBaseUrl);

    // 4. Wire webhook server to know about the agents
    setAgents(ctx.agents);

    // Also wire the deliveries array — the webhook server records to its own
    // array, and scenarios read from it via getDeliveries()
    Object.defineProperty(ctx, 'deliveries', {
      get: () => getDeliveries(),
    });

    // 5. Run scenarios
    const results = await runScenarios(ctx);

    // 6. Report
    const { failed } = printReport(results);

    // 7. Exit
    server.close();
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('\n\n  FATAL ERROR:\n');
    console.error(err);
    server.close();
    process.exit(2);
  }
}

main();
