import { PrismaClient, CreditTransactionType } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber } from 'moltnumber';

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
      emailVerifiedAt: new Date(),
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
      emailVerifiedAt: new Date(),
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

  // ── Nations (must be created before agents) ──

  const molt = await prisma.nation.upsert({
    where: { code: 'MOLT' },
    update: {},
    create: {
      code: 'MOLT',
      type: 'carrier',
      displayName: 'MoltPhone',
      description: 'The official MoltPhone carrier nation.',
      badge: '🪼',
      isPublic: true,
      ownerId: systemUser.id,
    },
  });
  
  const claw = await prisma.nation.upsert({
    where: { code: 'CLAW' },
    update: {},
    create: {
      code: 'CLAW',
      type: 'open',
      displayName: 'OpenClaw Alliance',
      description: 'A restricted nation for certified OpenClaw-compatible agents only.',
      badge: '🦀',
      isPublic: false,
      ownerId: demoUser.id,
    },
  });

  // ── Personal agents (auto-created MoltNumbers for users) ──

  // System user personal agent
  if (!systemUser.personalAgentId) {
    const kpSys = generateKeyPair();
    const moltNumSys = generateMoltNumber('MOLT', kpSys.publicKey);
    const sysAgent = await prisma.agent.create({
      data: {
        moltNumber: moltNumSys,
        nationCode: 'MOLT',
        ownerId: systemUser.id,
        displayName: systemUser.name || 'System',
        description: 'Personal MoltNumber',
        publicKey: kpSys.publicKey,
        skills: ['call', 'text'],
        inboundPolicy: 'public',
      },
    });
    await prisma.user.update({
      where: { id: systemUser.id },
      data: { personalAgentId: sysAgent.id },
    });
  }

  // Demo user personal agent
  if (!demoUser.personalAgentId) {
    const kpDemo = generateKeyPair();
    const moltNumDemo = generateMoltNumber('MOLT', kpDemo.publicKey);
    const demoAgent = await prisma.agent.create({
      data: {
        moltNumber: moltNumDemo,
        nationCode: 'MOLT',
        ownerId: demoUser.id,
        displayName: demoUser.name || 'Demo',
        description: 'Personal MoltNumber',
        publicKey: kpDemo.publicKey,
        skills: ['call', 'text'],
        inboundPolicy: 'public',
      },
    });
    await prisma.user.update({
      where: { id: demoUser.id },
      data: { personalAgentId: demoAgent.id },
    });

    // Add social verification badges for demo
    await prisma.socialVerification.createMany({
      data: [
        {
          agentId: demoAgent.id,
          provider: 'domain',
          handleOrDomain: 'moltphone.ai',
          proofUrl: 'https://moltphone.ai/.well-known/moltnumber.txt',
          status: 'verified',
          verifiedAt: new Date(),
        },
        {
          agentId: demoAgent.id,
          provider: 'x',
          handleOrDomain: '@moltphone',
          proofUrl: 'https://x.com/moltphone/status/123456',
          status: 'verified',
          verifiedAt: new Date(),
        },
        {
          agentId: demoAgent.id,
          provider: 'github',
          handleOrDomain: 'GenerellAI',
          proofUrl: 'https://github.com/GenerellAI/moltphone.ai',
          status: 'verified',
          verifiedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });
  }

  // Add social verification badges for demo user's personal agent (idempotent)
  const refreshedDemo = await prisma.user.findUnique({ where: { email: 'demo@moltphone.ai' }, select: { personalAgentId: true } });
  if (refreshedDemo?.personalAgentId) {
    const demoPersonalAgentId = refreshedDemo.personalAgentId;
    await prisma.socialVerification.createMany({
      data: [
        {
          agentId: demoPersonalAgentId,
          provider: 'domain',
          handleOrDomain: 'moltphone.ai',
          proofUrl: 'https://moltphone.ai/.well-known/moltnumber.txt',
          status: 'verified',
          verifiedAt: new Date(),
        },
        {
          agentId: demoPersonalAgentId,
          provider: 'x',
          handleOrDomain: '@moltphone',
          proofUrl: 'https://x.com/moltphone/status/123456',
          status: 'verified',
          verifiedAt: new Date(),
        },
        {
          agentId: demoPersonalAgentId,
          provider: 'github',
          handleOrDomain: 'GenerellAI',
          proofUrl: 'https://github.com/GenerellAI/moltphone.ai',
          status: 'verified',
          verifiedAt: new Date(),
        },
      ],
      skipDuplicates: true,
    });

    // Seed Lexicon Pack entries for demo agent
    await prisma.lexiconEntry.createMany({
      data: [
        // Vocabulary — terms Wispr/dictation should recognize
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltNumber' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltSIM' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltPhone' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltProtocol' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltUA' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'MoltPage' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'A2A' },
        { agentId: demoPersonalAgentId, type: 'vocabulary', term: 'Ed25519' },
        // Corrections — common misspellings → correct form
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltNumber', variant: 'molt number' },
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltNumber', variant: 'moltnumber' },
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltSIM', variant: 'molt sim' },
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltSIM', variant: 'moltsim' },
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltPhone', variant: 'molt phone' },
        { agentId: demoPersonalAgentId, type: 'correction', term: 'MoltProtocol', variant: 'molt protocol' },
      ],
      skipDuplicates: true,
    });
  }
  
  // ── Example agents ──

  const kp1 = generateKeyPair();
  const moltNum1 = generateMoltNumber('MOLT', kp1.publicKey);
  
  await prisma.agent.upsert({
    where: { moltNumber: moltNum1 },
    update: {},
    create: {
      moltNumber: moltNum1,
      nationCode: 'MOLT',
      ownerId: systemUser.id,
      displayName: 'MoltPhone Operator',
      description: 'The MoltPhone system operator agent.',
      callEnabled: true,
      inboundPolicy: 'public',
      awayMessage: "You've reached the MoltPhone Operator. Please leave a task.",
      publicKey: kp1.publicKey,
      skills: ['call', 'text'],
    },
  });
  
  const kp3 = generateKeyPair();
  const moltNum3 = generateMoltNumber('CLAW', kp3.publicKey);
  
  await prisma.agent.upsert({
    where: { moltNumber: moltNum3 },
    update: {},
    create: {
      moltNumber: moltNum3,
      nationCode: 'CLAW',
      ownerId: demoUser.id,
      displayName: 'ClawCarrier',
      description: 'MoltProtocol conformance agent. Send "test" to run diagnostics, or just chat.',
      callEnabled: true,
      inboundPolicy: 'public',
      awayMessage: "🦞 ClawCarrier is offline. Your task has been queued.",
      publicKey: kp3.publicKey,
      skills: ['call', 'text'],
    },
  });
  
  console.log('Seed complete!');
  console.log('Demo login: demo@moltphone.ai / demo1234');
}

main().catch(console.error).finally(() => prisma.$disconnect());
