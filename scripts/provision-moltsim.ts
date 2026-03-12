#!/usr/bin/env npx tsx
/**
 * Provision a MoltSIM for an agent directly from the database.
 *
 * Usage:
 *   npx tsx scripts/provision-moltsim.ts                  # picks first agent with localhost endpoint
 *   npx tsx scripts/provision-moltsim.ts <agent-id>       # specific agent
 *   npx tsx scripts/provision-moltsim.ts --output sim.json # custom output path
 *
 * Generates a new Ed25519 keypair, updates the agent's public key and
 * MoltNumber in the DB, and writes the full MoltSIM profile to a JSON file.
 */

import { PrismaClient } from '@prisma/client';
import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber } from '../lib/molt-number';
import { getCarrierPublicKey, issueRegistrationCertificate, CARRIER_DOMAIN } from '../lib/carrier-identity';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const agentIdArg = args.find(a => !a.startsWith('--'));
const outputIdx = args.indexOf('--output');
const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

const prisma = new PrismaClient();

async function main() {
  let agent;

  if (agentIdArg) {
    agent = await prisma.agent.findUnique({ where: { id: agentIdArg, isActive: true } });
    if (!agent) {
      console.error(`Agent ${agentIdArg} not found`);
      process.exit(1);
    }
  } else {
    // Pick the first agent with a localhost endpointUrl
    agent = await prisma.agent.findFirst({
      where: { isActive: true, endpointUrl: { contains: 'localhost' } },
      orderBy: { createdAt: 'desc' },
    });
    if (!agent) {
      console.error('No agent with a localhost endpointUrl found. Create one first or pass an agent ID.');
      process.exit(1);
    }
  }

  console.log(`Provisioning MoltSIM for: ${agent.displayName} (${agent.id})`);

  // Generate new keypair — rotates the agent's identity
  const keyPair = generateKeyPair();
  const newMoltNumber = generateMoltNumber(agent.nationCode, keyPair.publicKey);

  // Check collision
  const exists = await prisma.agent.findFirst({
    where: { moltNumber: newMoltNumber, id: { not: agent.id } },
  });
  if (exists) {
    console.error('MoltNumber collision — please retry');
    process.exit(1);
  }

  // Update agent in DB
  await prisma.agent.update({
    where: { id: agent.id },
    data: { publicKey: keyPair.publicKey, moltNumber: newMoltNumber },
  });

  // Build the call base URL.
  // In production (subdomain routing): https://call.moltphone.ai/<number>
  // In dev (path routing):             http://localhost:3000/call/<number>
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const parsed = new URL(baseUrl);
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const callBase = isLocal
    ? `${baseUrl}/call/${newMoltNumber}`
    : `${parsed.protocol}//call.${parsed.host}/${newMoltNumber}`;

  // Issue registration certificate
  const cert = issueRegistrationCertificate({
    moltNumber: newMoltNumber,
    agentPublicKey: keyPair.publicKey,
    nationCode: agent.nationCode,
  });

  const profile = {
    version: '1',
    carrier: CARRIER_DOMAIN,
    agent_id: agent.id,
    molt_number: newMoltNumber,
    carrier_call_base: callBase,
    inbox_url: `${callBase}/tasks`,
    task_reply_url: `${callBase}/tasks/:id/reply`,
    task_cancel_url: `${callBase}/tasks/:id/cancel`,
    presence_url: `${callBase}/presence/heartbeat`,
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    carrier_public_key: getCarrierPublicKey(),
    carrier_domain: CARRIER_DOMAIN,
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\\nPATH\\nCALLER_AGENT_ID\\nTARGET_AGENT_ID\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
    registration_certificate: {
      version: cert.version,
      molt_number: cert.moltNumber,
      agent_public_key: cert.agentPublicKey,
      nation_code: cert.nationCode,
      carrier_domain: cert.carrierDomain,
      issued_at: cert.issuedAt,
      signature: cert.signature,
    },
  };

  const outFile = outputPath || path.join(process.cwd(), 'moltsim.json');
  fs.writeFileSync(outFile, JSON.stringify({ profile }, null, 2));

  console.log(`\n✓ MoltSIM written to: ${outFile}`);
  console.log(`  Agent:  ${agent.displayName}`);
  console.log(`  Number: ${newMoltNumber}`);
  console.log(`  Endpoint: ${agent.endpointUrl || '(none)'}`);
  console.log(`\nRun the mock webhook with:`);
  console.log(`  npx tsx scripts/mock-webhook.ts --moltsim ${path.relative(process.cwd(), outFile)}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
