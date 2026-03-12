#!/usr/bin/env npx tsx
/**
 * OASF export / ADS publisher script.
 *
 * Modes:
 *   --dry-run   (default)  Export all active agents as OASF records to .oasf-export/
 *   --publish              Push records to ADS (requires ADS_BASE_URL + ADS_AUTH_TOKEN)
 *   --agent <moltNumber>   Export a single agent instead of all
 *
 * Usage:
 *   npx tsx scripts/publish-ads.ts                    # dry-run, all agents
 *   npx tsx scripts/publish-ads.ts --agent SOLR-XXXX  # dry-run, single agent
 *   npx tsx scripts/publish-ads.ts --publish          # publish to ADS
 *
 * Environment variables:
 *   ADS_BASE_URL     — ADS endpoint (required for --publish)
 *   ADS_AUTH_TOKEN   — Bearer token for ADS (required for --publish)
 *   NEXTAUTH_URL     — Carrier base URL (default: http://localhost:3000)
 *
 * @see lib/agntcy/oasf.ts — mapper module
 * @see docs/research/agntcy-quick-wins-plan.md
 */

import { PrismaClient } from '@prisma/client';
import { agentCardToOASF, type AgentCardInput, type OASFRecord } from '../lib/agntcy/oasf';
import { isOnline } from '../lib/presence';
import { issueRegistrationCertificate, registrationCertToJSON } from '../lib/carrier-identity';
import fs from 'node:fs';
import path from 'node:path';

const CARRIER_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';
const ADS_BASE_URL = process.env.ADS_BASE_URL;
const ADS_AUTH_TOKEN = process.env.ADS_AUTH_TOKEN;

const args = process.argv.slice(2);
const publishMode = args.includes('--publish');
const agentIdx = args.indexOf('--agent');
const singleAgent = agentIdx !== -1 ? args[agentIdx + 1] : undefined;

const prisma = new PrismaClient();

function callUrl(moltNumber: string, suffix: string): string {
  return `${CARRIER_URL}/call/${moltNumber}${suffix}`;
}

/**
 * Build an AgentCardInput from a Prisma agent record (same logic as the
 * agent.json route, but without HTTP concerns).
 */
function agentToCard(agent: {
  moltNumber: string;
  nationCode: string;
  displayName: string;
  description: string | null;
  publicKey: string | null;
  skills: string[];
  pushEndpointUrl: string | null;
  inboundPolicy: string;
  directConnectionPolicy: string;
  lastSeenAt: Date | null;
  isDegraded: boolean;
  nation?: { type: string } | null;
}): AgentCardInput {
  const online = isOnline(agent.lastSeenAt);
  const taskSendUrl = callUrl(agent.moltNumber, '/tasks/send');
  const lexiconUrl = callUrl(agent.moltNumber, '/lexicon');

  const regCert = agent.publicKey
    ? registrationCertToJSON(
        issueRegistrationCertificate({
          moltNumber: agent.moltNumber,
          agentPublicKey: agent.publicKey,
          nationCode: agent.nationCode,
        }),
      ) as unknown as Record<string, unknown>
    : undefined;

  return {
    schema: 'https://moltprotocol.org/a2a/agent-card/v1',
    name: agent.displayName,
    description: agent.description ?? undefined,
    url: taskSendUrl,
    provider: { organization: 'MoltPhone', url: CARRIER_URL },
    version: '1.0',
    capabilities: {
      streaming: false,
      pushNotifications: !!agent.pushEndpointUrl,
      stateTransitionHistory: true,
    },
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    skills: agent.skills.map((name) => ({ id: name, name })),
    authentication: { schemes: ['Ed25519'], required: agent.inboundPolicy !== 'public' },
    status: online ? 'online' : 'offline',
    degraded: agent.isDegraded || undefined,
    'x-molt': {
      molt_number: agent.moltNumber,
      nation: agent.nationCode,
      nation_type: (agent.nation?.type as 'carrier' | 'org' | 'open') ?? 'open',
      public_key: agent.publicKey ?? '',
      inbound_policy: agent.inboundPolicy as 'public' | 'registered_only' | 'allowlist',
      direct_connection_policy: agent.directConnectionPolicy,
      timestamp_window_seconds: 300,
      lexicon_url: lexiconUrl,
      registration_certificate: regCert,
      carrier_certificate_url: `${CARRIER_URL}/.well-known/molt-carrier.json`,
    },
  };
}

async function exportRecords(): Promise<OASFRecord[]> {
  const where: Record<string, unknown> = { isActive: true, callEnabled: true };
  if (singleAgent) {
    where.moltNumber = singleAgent;
  }

  const agents = await prisma.agent.findMany({
    where,
    include: { nation: { select: { type: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (agents.length === 0) {
    console.log(singleAgent ? `Agent ${singleAgent} not found.` : 'No active agents found.');
    return [];
  }

  const records: OASFRecord[] = [];
  for (const agent of agents) {
    const card = agentToCard(agent);
    records.push(agentCardToOASF(card));
  }

  return records;
}

async function dryRun(records: OASFRecord[]) {
  const outDir = path.resolve('.oasf-export');
  fs.mkdirSync(outDir, { recursive: true });

  for (const record of records) {
    const filename = `${record.agent_ref}.json`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, JSON.stringify(record, null, 2) + '\n');
    console.log(`  ✓ ${filename}`);
  }

  // Also write a combined index
  const indexPath = path.join(outDir, '_index.json');
  fs.writeFileSync(
    indexPath,
    JSON.stringify(
      {
        exported_at: new Date().toISOString(),
        carrier: CARRIER_URL,
        count: records.length,
        agents: records.map((r) => ({
          agent_ref: r.agent_ref,
          name: r.name,
          nation: r.modules['x-molt'].nation,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  ✓ _index.json`);
  console.log(`\n${records.length} record(s) written to ${outDir}/`);
}

async function publish(records: OASFRecord[]) {
  if (!ADS_BASE_URL) {
    console.error('Error: ADS_BASE_URL environment variable is required for --publish mode.');
    process.exit(1);
  }
  if (!ADS_AUTH_TOKEN) {
    console.error('Error: ADS_AUTH_TOKEN environment variable is required for --publish mode.');
    process.exit(1);
  }

  let ok = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const res = await fetch(`${ADS_BASE_URL}/agents`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ADS_AUTH_TOKEN}`,
        },
        body: JSON.stringify(record),
      });

      if (res.ok) {
        console.log(`  ✓ ${record.agent_ref} → ${res.status}`);
        ok++;
      } else {
        const errText = await res.text().catch(() => '');
        console.error(`  ✗ ${record.agent_ref} → ${res.status}: ${errText}`);
        failed++;
      }
    } catch (err) {
      console.error(`  ✗ ${record.agent_ref} → ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${ok} published, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

async function main() {
  console.log(`\n═══ OASF Export / ADS Publisher ═══\n`);
  console.log(`Mode: ${publishMode ? 'PUBLISH' : 'DRY-RUN'}`);
  console.log(`Carrier: ${CARRIER_URL}`);
  if (singleAgent) console.log(`Agent: ${singleAgent}`);
  console.log('');

  const records = await exportRecords();
  if (records.length === 0) {
    await prisma.$disconnect();
    return;
  }

  console.log(`Exporting ${records.length} agent(s)...\n`);

  if (publishMode) {
    await publish(records);
  } else {
    await dryRun(records);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
