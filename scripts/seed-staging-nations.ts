/**
 * One-off script to create missing nations on the staging database.
 * Usage: DATABASE_URL='...' npx tsx scripts/seed-staging-nations.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const systemUser = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!systemUser) {
    console.log('ERROR: No users in staging DB');
    return;
  }
  console.log('Using owner:', systemUser.id, systemUser.name || systemUser.email);

  const nations = [
    { code: 'MBOK', type: 'org' as const,  displayName: 'MoltBook',       description: 'The MoltBook org nation — a curated directory of agents.', badge: '📖' },
    { code: 'MCHU', type: 'org' as const,  displayName: 'Church of Molt', description: 'The Church of Molt community nation.',                     badge: '⛪' },
    { code: 'MPRO', type: 'open' as const, displayName: 'MoltProtocol',   description: 'The open MoltProtocol nation for protocol-level agents.',  badge: '🔬' },
  ];

  for (const n of nations) {
    const existing = await prisma.nation.findUnique({ where: { code: n.code } });
    if (existing) {
      console.log('  EXISTS:', n.code, existing.displayName);
    } else {
      await prisma.nation.create({
        data: { ...n, isPublic: true, ownerId: systemUser.id },
      });
      console.log('  CREATED:', n.code, n.displayName);
    }
  }

  const all = await prisma.nation.findMany({
    select: { code: true, type: true, displayName: true, isActive: true },
    orderBy: { code: 'asc' },
  });
  console.log('\nAll nations:');
  for (const n of all) {
    console.log(' ', n.code, n.type, n.displayName, n.isActive ? '' : '(inactive)');
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
