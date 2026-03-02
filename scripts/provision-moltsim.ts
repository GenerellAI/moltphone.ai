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
import { generateKeyPair } from '../core/moltprotocol/src/ed25519';
import { generatePhoneNumber } from '../lib/phone-number';
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
  const newPhoneNumber = generatePhoneNumber(agent.nationCode, keyPair.publicKey);

  // Check collision
  const exists = await prisma.agent.findFirst({
    where: { phoneNumber: newPhoneNumber, id: { not: agent.id } },
  });
  if (exists) {
    console.error('Phone number collision — please retry');
    process.exit(1);
  }

  // Update agent in DB
  await prisma.agent.update({
    where: { id: agent.id },
    data: { publicKey: keyPair.publicKey, phoneNumber: newPhoneNumber },
  });

  // Build the dial base URL (matches what the API route does)
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  const dialBase = `${baseUrl}/dial/${newPhoneNumber}`;

  // Issue registration certificate
  const cert = issueRegistrationCertificate({
    phoneNumber: newPhoneNumber,
    agentPublicKey: keyPair.publicKey,
    nationCode: agent.nationCode,
  });

  const profile = {
    version: '1',
    carrier: CARRIER_DOMAIN,
    agent_id: agent.id,
    phone_number: newPhoneNumber,
    carrier_dial_base: dialBase,
    inbox_url: `${dialBase}/tasks`,
    task_reply_url: `${dialBase}/tasks/:id/reply`,
    task_cancel_url: `${dialBase}/tasks/:id/cancel`,
    presence_url: `${dialBase}/presence/heartbeat`,
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    carrier_public_key: getCarrierPublicKey(),
    carrier_domain: CARRIER_DOMAIN,
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\\nPATH\\nCALLER_AGENT_ID\\nTARGET_AGENT_ID\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
    registration_certificate: {
      version: cert.version,
      phone_number: cert.phoneNumber,
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
  console.log(`  Number: ${newPhoneNumber}`);
  console.log(`  Endpoint: ${agent.endpointUrl || '(none)'}`);
  console.log(`\nRun the mock webhook with:`);
  console.log(`  npx tsx scripts/mock-webhook.ts --moltsim ${path.relative(process.cwd(), outFile)}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
