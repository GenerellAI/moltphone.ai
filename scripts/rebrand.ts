#!/usr/bin/env tsx
/**
 * Carrier Rebrand Utility
 * =======================
 *
 * Replaces MoltPhone-specific branding across the codebase so a forked
 * carrier can run under its own identity.
 *
 * Usage:
 *   npx tsx scripts/rebrand.ts rebrand.json
 *   npx tsx scripts/rebrand.ts --name "MyCarrier" --domain "mycarrier.com"
 *
 * After running, verify with:
 *   npx jest __tests__/rebrand-check.test.ts
 *
 * Config JSON example (all fields except name & domain are optional):
 * {
 *   "carrierName":        "MyCarrier",
 *   "carrierDomain":      "mycarrier.com",
 *   "carrierDescription": "Autonomous Agent Network",
 *   "carrierEmoji":       "🚀",
 *   "defaultNationCode":  "MYCA",
 *   "companyDomain":      "mycompany.com",
 *   "githubOrg":          "MyOrg",
 *   "brandColor":         "#FF6B35"
 * }
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// ── Types ────────────────────────────────────────────────

interface RebrandConfig {
  carrierName: string;
  carrierDomain: string;
  carrierDescription?: string;
  carrierEmoji?: string;
  defaultNationCode?: string;
  companyDomain?: string;
  githubOrg?: string;
  brandColor?: string;
}

// ── Old MoltPhone defaults (what we replace FROM) ────────

const OLD = {
  carrierName: 'MoltPhone',
  carrierDomain: 'moltphone.ai',
  carrierDescription: 'AI Agent Carrier',
  carrierEmoji: '🪼',
  defaultNationCode: 'MPHO',
  companyDomain: 'generell.ai',
  githubOrg: 'GenerellAI',
  brandColor: '#2D7DFF',
} as const;

// ── File discovery ───────────────────────────────────────

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.css', '.json', '.yml', '.yaml', '.py', '.mjs',
]);

/** Exact relative paths that don't match by extension but should be scanned. */
const EXPLICIT_FILES = new Set(['.env.example']);

/** Directory names to skip entirely. */
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git', 'core', '__tests__', 'e2e', 'docs',
]);

/** Relative paths to never modify. */
const SKIP_FILES = new Set([
  'scripts/rebrand.ts',  // don't rebrand the rebrander
]);

function walkFiles(dir: string, root: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(root, fullPath);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      results.push(...walkFiles(fullPath, root));
    } else if (entry.isFile()) {
      if (SKIP_FILES.has(relPath)) continue;
      const ext = path.extname(entry.name);
      if (TEXT_EXTENSIONS.has(ext) || EXPLICIT_FILES.has(relPath)) {
        results.push(relPath);
      }
    }
  }
  return results;
}

// ── Replacement engine ───────────────────────────────────

interface Replacement {
  from: string;
  to: string;
  label: string;
}

/**
 * Build an ordered list of string replacements.
 *
 * Order matters — more specific patterns (domain) come before less specific
 * ones (name, lowercase) to prevent partial matches.
 *
 * Protocol terms (MoltProtocol, MoltNumber, MoltSIM, MoltUA, MoltCredits,
 * x-molt-*) are never matched because "MoltPhone" and "moltphone" are
 * distinct strings that don't overlap with them.
 */
function buildReplacements(config: RebrandConfig): Replacement[] {
  const reps: Replacement[] = [];
  const lower = config.carrierName.toLowerCase();

  // 1. Domain (most specific — do first so "moltphone" in "moltphone.ai" is consumed)
  reps.push({
    from: OLD.carrierDomain,
    to: config.carrierDomain,
    label: `domain: ${OLD.carrierDomain} → ${config.carrierDomain}`,
  });

  // 2. Display name (MoltPhone → NewName)
  reps.push({
    from: OLD.carrierName,
    to: config.carrierName,
    label: `name: ${OLD.carrierName} → ${config.carrierName}`,
  });

  // 3. Lowercase (moltphone → newname) — catches DB names, headers, localStorage, etc.
  reps.push({
    from: OLD.carrierName.toLowerCase(),
    to: lower,
    label: `lowercase: moltphone → ${lower}`,
  });

  // 4. Carrier description
  if (config.carrierDescription && config.carrierDescription !== OLD.carrierDescription) {
    reps.push({
      from: OLD.carrierDescription,
      to: config.carrierDescription,
      label: `description: ${OLD.carrierDescription} → ${config.carrierDescription}`,
    });
  }

  // 5. Emoji
  if (config.carrierEmoji && config.carrierEmoji !== OLD.carrierEmoji) {
    reps.push({
      from: OLD.carrierEmoji,
      to: config.carrierEmoji,
      label: `emoji: ${OLD.carrierEmoji} → ${config.carrierEmoji}`,
    });
  }

  // 6. Default nation code (only standalone quoted strings: 'MPHO' / "MPHO")
  if (config.defaultNationCode && config.defaultNationCode !== OLD.defaultNationCode) {
    reps.push({
      from: `'${OLD.defaultNationCode}'`,
      to: `'${config.defaultNationCode}'`,
      label: `nation code: '${OLD.defaultNationCode}' → '${config.defaultNationCode}'`,
    });
    reps.push({
      from: `"${OLD.defaultNationCode}"`,
      to: `"${config.defaultNationCode}"`,
      label: `nation code: "${OLD.defaultNationCode}" → "${config.defaultNationCode}"`,
    });
  }

  // 7. Company domain
  if (config.companyDomain && config.companyDomain !== OLD.companyDomain) {
    reps.push({
      from: OLD.companyDomain,
      to: config.companyDomain,
      label: `company: ${OLD.companyDomain} → ${config.companyDomain}`,
    });
  }

  // 8. GitHub org
  if (config.githubOrg && config.githubOrg !== OLD.githubOrg) {
    reps.push({
      from: OLD.githubOrg,
      to: config.githubOrg,
      label: `github: ${OLD.githubOrg} → ${config.githubOrg}`,
    });
  }

  // 9. Brand color
  if (config.brandColor && config.brandColor !== OLD.brandColor) {
    reps.push({
      from: OLD.brandColor,
      to: config.brandColor,
      label: `color: ${OLD.brandColor} → ${config.brandColor}`,
    });
  }

  return reps;
}

function applyReplacements(content: string, reps: Replacement[]): string {
  let result = content;
  for (const r of reps) {
    result = result.split(r.from).join(r.to);
  }
  return result;
}

// ── Config loading ───────────────────────────────────────

function loadConfig(): RebrandConfig {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error(USAGE);
    process.exit(1);
  }

  // JSON file mode
  if (args[0].endsWith('.json')) {
    const configPath = path.resolve(args[0]);
    if (!fs.existsSync(configPath)) {
      console.error(`Config file not found: ${configPath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    if (!raw.carrierName || !raw.carrierDomain) {
      console.error('Config must include "carrierName" and "carrierDomain".');
      process.exit(1);
    }
    return raw as RebrandConfig;
  }

  // CLI flag mode
  const config: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    if (!value) {
      console.error(`Missing value for flag: ${flag}`);
      process.exit(1);
    }
    switch (flag) {
      case '--name': config.carrierName = value; break;
      case '--domain': config.carrierDomain = value; break;
      case '--description': config.carrierDescription = value; break;
      case '--emoji': config.carrierEmoji = value; break;
      case '--nation': config.defaultNationCode = value; break;
      case '--company-domain': config.companyDomain = value; break;
      case '--github-org': config.githubOrg = value; break;
      case '--brand-color': config.brandColor = value; break;
      default:
        console.error(`Unknown flag: ${flag}\n`);
        console.error(USAGE);
        process.exit(1);
    }
  }

  if (!config.carrierName || !config.carrierDomain) {
    console.error('--name and --domain are required.\n');
    console.error(USAGE);
    process.exit(1);
  }

  return config as unknown as RebrandConfig;
}

// ── Validation ───────────────────────────────────────────

function validate(config: RebrandConfig): void {
  if (config.carrierName.length < 2 || config.carrierName.length > 50) {
    console.error('carrierName must be 2–50 characters.');
    process.exit(1);
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(config.carrierDomain)) {
    console.error(`carrierDomain doesn't look like a valid domain: ${config.carrierDomain}`);
    process.exit(1);
  }
  if (config.defaultNationCode && !/^[A-Z]{3,6}$/.test(config.defaultNationCode)) {
    console.error('defaultNationCode must be 3–6 uppercase letters.');
    process.exit(1);
  }
  if (config.brandColor && !/^#[0-9a-fA-F]{6}$/.test(config.brandColor)) {
    console.error('brandColor must be a hex color like #FF6B35.');
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────

const USAGE = `
Usage:
  npx tsx scripts/rebrand.ts <config.json>
  npx tsx scripts/rebrand.ts --name "MyCarrier" --domain "mycarrier.com" [options]

Options:
  --name <name>              Carrier display name (required)
  --domain <domain>          Carrier domain (required)
  --description <text>       Carrier tagline
  --emoji <emoji>            Brand emoji (replaces 🪼)
  --nation <CODE>            Default nation code (replaces MOLT)
  --company-domain <domain>  Company website domain
  --github-org <org>         GitHub organization name
  --brand-color <hex>        Primary brand color (replaces #2D7DFF)
`.trim();

function main() {
  const config = loadConfig();
  validate(config);

  const root = path.resolve(__dirname, '..');
  const reps = buildReplacements(config);

  console.log('\n🔄  MoltProtocol Carrier Rebrand\n');
  console.log('Replacements:');
  for (const r of reps) {
    console.log(`  • ${r.label}`);
  }

  // ── Discover files ──
  const files = walkFiles(root, root).sort();
  console.log(`\nScanning ${files.length} files...\n`);

  const changed: Array<{ file: string; count: number }> = [];
  let totalReplacements = 0;

  for (const relPath of files) {
    const absPath = path.join(root, relPath);
    const original = fs.readFileSync(absPath, 'utf-8');
    const updated = applyReplacements(original, reps);

    if (updated !== original) {
      // Count changes (approximate — counts total substring hits)
      let count = 0;
      for (const r of reps) {
        const matches = original.split(r.from).length - 1;
        count += matches;
      }
      fs.writeFileSync(absPath, updated, 'utf-8');
      changed.push({ file: relPath, count });
      totalReplacements += count;
    }
  }

  // ── Report ──
  if (changed.length === 0) {
    console.log('No changes needed — branding already matches config.');
  } else {
    console.log(`Modified ${changed.length} files (${totalReplacements} replacements):\n`);
    for (const { file, count } of changed) {
      console.log(`  ✓ ${file} (${count})`);
    }
  }

  // ── Remove MoltPhone mascot from landing page ──
  removeMascotFromLandingPage(root);

  // ── Remove mascot CSS from globals.css ──
  removeMascotCSS(root);

  // ── Delete mascot media files ──
  deleteMascotMedia(root);

  // ── Regenerate favicons with new emoji ──
  regenerateFavicons(root, config.carrierEmoji || OLD.carrierEmoji);

  // ── Manual steps ──
  console.log('\n📋  Manual steps remaining:');
  console.log('  1. Update .env with CARRIER_DOMAIN, CARRIER_NAME');
  console.log('  2. Update documentation: README.md, AGENTS.md, TODO.md');
  console.log('  3. Update test fixtures in __tests__/ and e2e/');
  console.log('  4. Run seed: npx prisma db seed');
  console.log('  5. Verify: npx jest __tests__/rebrand-check.test.ts\n');
}

// ── Mascot removal ───────────────────────────────────────

/**
 * Remove the MoltPhone mascot block from the landing page.
 * The mascot is carrier-specific branding. The MoltProtocol reef stays.
 */
function removeMascotFromLandingPage(root: string): void {
  const pagePath = path.join(root, 'app/page.tsx');
  if (!fs.existsSync(pagePath)) return;

  let content = fs.readFileSync(pagePath, 'utf-8');
  const original = content;

  // Remove the MascotAudio import line
  content = content.replace(/^import MascotAudio from [^\n]+\n/m, '');

  // Remove the mascot block: {/* Mascot */} through </MascotAudio>
  // This regex matches the comment, the MascotAudio wrapper, and everything inside
  content = content.replace(
    /\n\s*\{\s*\/\*\s*Mascot\s*\*\/\s*\}\s*\n\s*<MascotAudio>[\s\S]*?<\/MascotAudio>\s*\n/,
    '\n'
  );

  if (content !== original) {
    fs.writeFileSync(pagePath, content, 'utf-8');
    console.log('\n🎭  Removed MoltPhone mascot from landing page');
  }
}

/**
 * Remove mascot-related CSS from globals.css.
 */
function removeMascotCSS(root: string): void {
  const cssPath = path.join(root, 'app/globals.css');
  if (!fs.existsSync(cssPath)) return;

  let content = fs.readFileSync(cssPath, 'utf-8');
  const original = content;

  // Remove the mascot CSS block (comment + all rules containing .mascot- selectors)
  content = content.replace(
    /\n?\/\* ── Mascot \(theme-adaptive\)[^*]*\*\/\n(?:(?:\.[\w\s]+)?\.mascot[^}]+\}\n?)+/,
    '\n'
  );

  if (content !== original) {
    fs.writeFileSync(cssPath, content, 'utf-8');
    console.log('🎨  Removed mascot CSS from globals.css');
  }
}

/**
 * Delete MoltPhone mascot media files.
 */
function deleteMascotMedia(root: string): void {
  const mascotFiles = [
    'public/images/moltphone-mascot.webp',
    'public/images/moltphone-mascot.mp4',
    'public/images/moltphone-mascot.m4a',
  ];

  const deleted: string[] = [];
  for (const relPath of mascotFiles) {
    const absPath = path.join(root, relPath);
    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
      deleted.push(relPath);
    }
  }

  if (deleted.length > 0) {
    console.log(`🗑️   Deleted ${deleted.length} mascot media file(s):`);
    for (const f of deleted) {
      console.log(`  ✓ ${f}`);
    }
  }
}

/**
 * Update gen_favicons.py with the new emoji and run it (if Python + Pillow available).
 */
function regenerateFavicons(root: string, emoji: string): void {
  const pyPath = path.join(root, 'scripts/gen_favicons.py');
  if (!fs.existsSync(pyPath)) {
    console.log('\n⚠️  scripts/gen_favicons.py not found — skipping favicon generation');
    return;
  }

  // Update the EMOJI constant in the Python script
  let pyContent = fs.readFileSync(pyPath, 'utf-8');
  const originalPy = pyContent;
  pyContent = pyContent.replace(/^EMOJI = "[^"]*"/m, `EMOJI = "${emoji}"`);

  if (pyContent !== originalPy) {
    fs.writeFileSync(pyPath, pyContent, 'utf-8');
    console.log(`\n🎨  Updated favicon emoji to ${emoji}`);
  }

  // Try to run the favicon generator
  try {
    execSync('python3 scripts/gen_favicons.py', {
      cwd: root,
      stdio: 'pipe',
      timeout: 30_000,
    });
    console.log('✅  Favicons regenerated successfully');
  } catch {
    console.log('⚠️  Could not run gen_favicons.py (requires Python 3 + Pillow)');
    console.log('    Run manually: python3 scripts/gen_favicons.py');
  }
}

main();
