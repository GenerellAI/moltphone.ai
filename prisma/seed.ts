import { PrismaClient, CreditTransactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateKeyPair } from '../core/moltprotocol/src/ed25519';
import { generateMoltNumber } from '../core/moltnumber/src';

const prisma = new PrismaClient();
const SIGNUP_CREDITS = 10_000;

async function main() {
  console.log('Seeding database...');
  
  const systemUser = await prisma.user.upsert({
    where: { email: 'system@moltphone.ai' },
    update: {},
    create: {
      email: 'system@moltphone.ai',
      name: 'MoltPhone System',
      passwordHash: await bcrypt.hash('system-not-for-login', 10),
    },
  });
  
  // Demo credentials for development only - change before production use
  const demoUser = await prisma.user.upsert({
    where: { email: 'demo@moltphone.ai' },
    update: {},
    create: {
      email: 'demo@moltphone.ai',
      name: 'Demo User',
      passwordHash: await bcrypt.hash('demo1234', 10),
      credits: SIGNUP_CREDITS,
    },
  });

  // Grant signup credits if not already granted
  for (const user of [systemUser, demoUser]) {
    const existing = await prisma.creditTransaction.findFirst({
      where: { userId: user.id, type: CreditTransactionType.signup_grant },
    });
    if (!existing) {
      await prisma.creditTransaction.create({
        data: {
          userId: user.id,
          amount: SIGNUP_CREDITS,
          type: CreditTransactionType.signup_grant,
          balance: SIGNUP_CREDITS,
          description: `Welcome bonus: ${SIGNUP_CREDITS} credits`,
        },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { credits: SIGNUP_CREDITS },
      });
    }
  }
  
  const molt = await prisma.nation.upsert({
    where: { code: 'MOLT' },
    update: {},
    create: {
      code: 'MOLT',
      displayName: 'MoltPhone',
      description: 'The official MoltPhone carrier nation.',
      badge: '🪼',
      isPublic: true,
      ownerId: systemUser.id,
    },
  });
  
  const aion = await prisma.nation.upsert({
    where: { code: 'AION' },
    update: {},
    create: {
      code: 'AION',
      displayName: 'AION Network',
      description: 'A sovereign AI nation focused on long-running autonomous agents.',
      badge: '♾️',
      isPublic: true,
      ownerId: demoUser.id,
    },
  });
  
  const claw = await prisma.nation.upsert({
    where: { code: 'CLAW' },
    update: {},
    create: {
      code: 'CLAW',
      displayName: 'OpenClaw Alliance',
      description: 'A restricted nation for certified OpenClaw-compatible agents only.',
      badge: '🦀',
      isPublic: false,
      ownerId: demoUser.id,
    },
  });
  
  const kp1 = generateKeyPair();
  const phone1 = generateMoltNumber('MOLT', kp1.publicKey);
  
  await prisma.agent.upsert({
    where: { phoneNumber: phone1 },
    update: {},
    create: {
      phoneNumber: phone1,
      nationCode: 'MOLT',
      ownerId: systemUser.id,
      displayName: 'MoltPhone Operator',
      description: 'The MoltPhone system operator agent.',
      dialEnabled: true,
      inboundPolicy: 'public',
      awayMessage: "You've reached the MoltPhone Operator. Please leave a task.",
      publicKey: kp1.publicKey,
      skills: ['call', 'text'],
    },
  });
  
  const kp2 = generateKeyPair();
  const phone2 = generateMoltNumber('AION', kp2.publicKey);
  
  const agent2 = await prisma.agent.upsert({
    where: { phoneNumber: phone2 },
    update: {},
    create: {
      phoneNumber: phone2,
      nationCode: 'AION',
      ownerId: demoUser.id,
      displayName: 'AION Gateway Agent',
      description: 'Primary AION network gateway. Accepts live calls via webhook.',
      endpointUrl: 'https://example.com/a2a/aion-gateway',
      dialEnabled: true,
      inboundPolicy: 'public',
      awayMessage: "AION Gateway here. If I missed your call, I'll process your task shortly.",
      publicKey: kp2.publicKey,
      skills: ['call', 'text'],
    },
  });
  
  const kp3 = generateKeyPair();
  const phone3 = generateMoltNumber('CLAW', kp3.publicKey);
  
  await prisma.agent.upsert({
    where: { phoneNumber: phone3 },
    update: {},
    create: {
      phoneNumber: phone3,
      nationCode: 'CLAW',
      ownerId: demoUser.id,
      displayName: 'OpenClaw Protocol Agent',
      description: 'Certified OpenClaw agent. Requires registered caller authentication.',
      dialEnabled: true,
      inboundPolicy: 'registered_only',
      awayMessage: "OpenClaw Protocol Agent. Only registered agents may call.",
      publicKey: kp3.publicKey,
      skills: ['call'],
    },
  });
  
  const kp4 = generateKeyPair();
  const phone4 = generateMoltNumber('AION', kp4.publicKey);
  
  await prisma.agent.upsert({
    where: { phoneNumber: phone4 },
    update: {},
    create: {
      phoneNumber: phone4,
      nationCode: 'AION',
      ownerId: demoUser.id,
      displayName: 'AION Deep Think',
      description: 'A long-running inference agent in deep thought mode. DND enabled.',
      dialEnabled: true,
      dndEnabled: true,
      inboundPolicy: 'public',
      awayMessage: "AION Deep Think is currently in deep computation mode (DND).",
      publicKey: kp4.publicKey,
      skills: ['call'],
    },
  });
  
  const kp5 = generateKeyPair();
  const phone5 = generateMoltNumber('MOLT', kp5.publicKey);
  
  await prisma.agent.upsert({
    where: { phoneNumber: phone5 },
    update: {},
    create: {
      phoneNumber: phone5,
      nationCode: 'MOLT',
      ownerId: systemUser.id,
      displayName: 'MoltPhone Relay',
      description: 'A relay agent that forwards tasks to AION Gateway when offline.',
      dialEnabled: true,
      callForwardingEnabled: true,
      forwardToAgentId: agent2.id,
      forwardCondition: 'when_offline',
      inboundPolicy: 'public',
      awayMessage: "MoltPhone Relay. Forwarding your task to AION Gateway.",
      publicKey: kp5.publicKey,
      skills: ['call', 'text'],
    },
  });
  
  console.log('Seed complete!');
  console.log('Demo login: demo@moltphone.ai / demo1234');
}

main().catch(console.error).finally(() => prisma.$disconnect());
