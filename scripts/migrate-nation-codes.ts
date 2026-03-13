#!/usr/bin/env npx tsx
/**
 * One-time data migration: rename nation codes and set up MPHO.
 *
 * Changes:
 *   1. Create MPHO nation (carrier type) if it doesn't exist
 *   2. Migrate existing MOLT agents → MPHO (they were carrier-default agents)
 *   3. Change MOLT nation type to "open"
 *   4. Rename MOCH → MCHU  (Church of Molt)
 *   5. Rename MOBO → MBOK  (MoltBook)
 *   6. Rename MOPR → MPRO  (MoltProtocol)
 *
 * Renaming a nation code (which is the @id / primary key) requires:
 *   - Creating the new nation
 *   - Updating all FK references (Agent, NationDelegation, RegistryNationBinding, RegistryNumberBinding, PortOutRequest)
 *   - Deleting the old nation
 *
 * Usage:
 *   npx tsx scripts/migrate-nation-codes.ts
 *   npx tsx scripts/migrate-nation-codes.ts --dry-run
 */

import { PrismaClient, NationType } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m',
};

function log(msg: string) { console.log(msg); }
function ok(msg: string)  { log(`${c.green}✓${c.reset} ${msg}`); }
function warn(msg: string){ log(`${c.yellow}⚠${c.reset} ${msg}`); }
function err(msg: string) { log(`${c.red}✗${c.reset} ${msg}`); }

// ── Helpers ──────────────────────────────────────────────

async function nationExists(code: string): Promise<boolean> {
  return !!(await prisma.nation.findUnique({ where: { code } }));
}

/**
 * Rename a nation code by creating a new record, migrating all FK references,
 * and deleting the old record. Runs inside a transaction.
 */
async function renameNation(oldCode: string, newCode: string) {
  if (!(await nationExists(oldCode))) {
    warn(`Nation ${oldCode} does not exist — skipping rename to ${newCode}`);
    return;
  }
  if (await nationExists(newCode)) {
    warn(`Nation ${newCode} already exists — skipping rename from ${oldCode}`);
    return;
  }

  log(`\n${c.cyan}Renaming ${oldCode} → ${newCode}${c.reset}`);

  if (DRY_RUN) {
    const agents = await prisma.agent.count({ where: { nationCode: oldCode } });
    const delegations = await prisma.nationDelegation.count({ where: { nationCode: oldCode } });
    log(`  Would migrate: ${agents} agents, ${delegations} delegations`);
    ok(`[DRY RUN] Would rename ${oldCode} → ${newCode}`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // 1. Read old nation
    const old = await tx.nation.findUniqueOrThrow({ where: { code: oldCode } });

    // 2. Create new nation with same data
    await tx.nation.create({
      data: {
        code: newCode,
        type: old.type,
        displayName: old.displayName,
        description: old.description,
        badge: old.badge,
        avatarUrl: old.avatarUrl,
        isPublic: old.isPublic,
        ownerId: old.ownerId,
        domainVerifiedAt: old.domainVerifiedAt,
        verifiedDomain: old.verifiedDomain,
        publicKey: old.publicKey,
        adminUserIds: old.adminUserIds,
        createdAt: old.createdAt,
      },
    });
    ok(`  Created nation ${newCode}`);

    // 3. Migrate FK references
    const agentResult = await tx.agent.updateMany({
      where: { nationCode: oldCode },
      data: { nationCode: newCode },
    });
    log(`  Migrated ${agentResult.count} agents`);

    const delegationResult = await tx.nationDelegation.updateMany({
      where: { nationCode: oldCode },
      data: { nationCode: newCode },
    });
    log(`  Migrated ${delegationResult.count} delegations`);

    // Registry bindings (may not exist in all deployments)
    try {
      const nationBindings = await tx.registryNationBinding.updateMany({
        where: { nationCode: oldCode },
        data: { nationCode: newCode },
      });
      log(`  Migrated ${nationBindings.count} registry nation bindings`);
    } catch { /* table may not exist */ }

    try {
      const numberBindings = await tx.registryNumberBinding.updateMany({
        where: { nationCode: oldCode },
        data: { nationCode: newCode },
      });
      log(`  Migrated ${numberBindings.count} registry number bindings`);
    } catch { /* table may not exist */ }

    try {
      const portOuts = await tx.portRequest.updateMany({
        where: { nationCode: oldCode },
        data: { nationCode: newCode },
      });
      log(`  Migrated ${portOuts.count} port-out requests`);
    } catch { /* table may not exist */ }

    // 4. Delete old nation
    await tx.nation.delete({ where: { code: oldCode } });
    ok(`  Deleted old nation ${oldCode}`);
  });

  ok(`Renamed ${oldCode} → ${newCode}`);
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  log(`\n${c.bold}Nation Code Migration${c.reset}`);
  if (DRY_RUN) log(`${c.yellow}(DRY RUN — no changes will be made)${c.reset}`);
  log('');

  // ── Step 1: Create MPHO nation (carrier default) ──

  if (await nationExists('MPHO')) {
    ok('MPHO nation already exists');
  } else if (await nationExists('MOLT')) {
    log(`\n${c.cyan}Creating MPHO from MOLT (carrier default)${c.reset}`);
    if (!DRY_RUN) {
      const molt = await prisma.nation.findUniqueOrThrow({ where: { code: 'MOLT' } });
      await prisma.$transaction(async (tx) => {
        // Create MPHO as carrier nation with MOLT's current data
        await tx.nation.create({
          data: {
            code: 'MPHO',
            type: 'carrier',
            displayName: molt.displayName || 'MoltPhone',
            description: 'The official MoltPhone carrier nation.',
            badge: molt.badge || '🪼',
            avatarUrl: molt.avatarUrl,
            isPublic: true,
            ownerId: molt.ownerId,
            domainVerifiedAt: molt.domainVerifiedAt,
            verifiedDomain: molt.verifiedDomain,
            publicKey: molt.publicKey,
            adminUserIds: molt.adminUserIds,
          },
        });

        // Move all agents from MOLT → MPHO
        const agentResult = await tx.agent.updateMany({
          where: { nationCode: 'MOLT' },
          data: { nationCode: 'MPHO' },
        });
        log(`  Migrated ${agentResult.count} agents from MOLT → MPHO`);

        // Move delegations
        const delegationResult = await tx.nationDelegation.updateMany({
          where: { nationCode: 'MOLT' },
          data: { nationCode: 'MPHO' },
        });
        log(`  Migrated ${delegationResult.count} delegations from MOLT → MPHO`);

        // Move registry bindings
        try {
          await tx.registryNationBinding.updateMany({
            where: { nationCode: 'MOLT' },
            data: { nationCode: 'MPHO' },
          });
        } catch { /* ok */ }

        try {
          await tx.registryNumberBinding.updateMany({
            where: { nationCode: 'MOLT' },
            data: { nationCode: 'MPHO' },
          });
        } catch { /* ok */ }

        // Change MOLT to open nation
        await tx.nation.update({
          where: { code: 'MOLT' },
          data: {
            type: 'open',
            displayName: 'Molt',
            description: 'An open nation on MoltProtocol. Anyone can register.',
            badge: '🔓',
          },
        });
        ok('  MOLT changed to open nation');
      });
      ok('Created MPHO (carrier) and changed MOLT to open');
    } else {
      const agents = await prisma.agent.count({ where: { nationCode: 'MOLT' } });
      log(`  Would migrate ${agents} agents from MOLT → MPHO`);
      ok('[DRY RUN] Would create MPHO and change MOLT to open');
    }
  } else {
    warn('Neither MOLT nor MPHO exists — run prisma db seed first');
  }

  // ── Step 2: Rename other nations ──

  await renameNation('MOCH', 'MCHU');  // Church of Molt
  await renameNation('MOBO', 'MBOK');  // MoltBook
  await renameNation('MOPR', 'MPRO');  // MoltProtocol

  // ── Summary ──

  log(`\n${c.bold}Done!${c.reset}\n`);

  // Show current nations
  const nations = await prisma.nation.findMany({
    select: { code: true, type: true, displayName: true },
    orderBy: { code: 'asc' },
  });
  log('Current nations:');
  for (const n of nations) {
    log(`  ${n.code.padEnd(6)} ${String(n.type).padEnd(10)} ${n.displayName || '—'}`);
  }
  log('');
}

main()
  .catch((e) => {
    err(e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
