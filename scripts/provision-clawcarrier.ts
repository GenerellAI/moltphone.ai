/**
 * Provision a MoltSIM for ClawCarrier.
 * Run: npx tsx scripts/provision-clawcarrier.ts
 */
import { PrismaClient } from '@prisma/client';
import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber } from 'moltnumber';
import { getCarrierPublicKey, issueRegistrationCertificate } from '../lib/carrier-identity';
import fs from 'fs';
import path from 'path';

const CALL_BASE_URL = process.env.CALL_BASE_URL || 'http://call.localhost:3000';
function callUrl(phone: string, p = '') { return `${CALL_BASE_URL}/${phone}${p}`; }

const prisma = new PrismaClient();

async function main() {
  const agent = await prisma.agent.findFirst({
    where: { displayName: 'ClawCarrier' },
  });
  if (!agent) throw new Error('ClawCarrier agent not found in database');

  console.log(`Found ClawCarrier: ${agent.id} (${agent.moltNumber})`);

  // Generate new keypair and derive self-certifying MoltNumber
  const keyPair = generateKeyPair();
  const newPhone = generateMoltNumber(agent.nationCode, keyPair.publicKey);

  // Update agent in DB with new key and number
  await prisma.agent.update({
    where: { id: agent.id },
    data: { publicKey: keyPair.publicKey, moltNumber: newPhone },
  });

  // Issue registration certificate
  const cert = issueRegistrationCertificate({
    moltNumber: newPhone,
    agentPublicKey: keyPair.publicKey,
    nationCode: agent.nationCode,
  });

  const profile = {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: agent.id,
    molt_number: newPhone,
    carrier_call_base: CALL_BASE_URL,
    inbox_url: callUrl(newPhone, '/tasks'),
    task_reply_url: callUrl(newPhone, '/tasks/:id/reply'),
    task_cancel_url: callUrl(newPhone, '/tasks/:id/cancel'),
    presence_url: callUrl(newPhone, '/presence/heartbeat'),
    public_key: keyPair.publicKey,
    private_key: keyPair.privateKey,
    carrier_public_key: getCarrierPublicKey(),
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

  const outDir = path.join(__dirname, '..', 'docker', 'clawcarrier', 'secrets');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'moltsim.json');
  fs.writeFileSync(outPath, JSON.stringify({ profile }, null, 2));

  console.log('');
  console.log('MoltSIM provisioned!');
  console.log(`  MoltNumber: ${newPhone}`);
  console.log(`  Saved to:   ${outPath}`);
  console.log('');
  console.log('To run ClawCarrier:');
  console.log(`  MOLTSIM_PATH=${outPath} node docker/clawcarrier/agent.js`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
