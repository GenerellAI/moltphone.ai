/**
 * Rebrand Verification Test
 * =========================
 *
 * After running `npx tsx scripts/rebrand.ts`, this test scans the source
 * codebase to verify no stale MoltPhone branding remains.
 *
 * Behaviour:
 *   - If carrier.config.ts still has MoltPhone defaults → test is skipped
 *     (you ARE MoltPhone, stale references are expected).
 *   - If carrier.config.ts has been rebranded → test scans for leftover
 *     "moltphone.ai" domain and "MoltPhone" name references and fails
 *     if any are found outside allowed locations.
 *
 * Run:
 *   npx jest __tests__/rebrand-check.test.ts
 */

import fs from 'fs';
import path from 'path';

// ── Config ───────────────────────────────────────────────

// Import carrier config values — these are the CURRENT branding.
// We use require() to avoid ts-jest module resolution issues with
// the carrier.config.ts root-level file.
const carrierConfig = require('../carrier.config');
const CARRIER_NAME: string = carrierConfig.CARRIER_NAME;
const CARRIER_DOMAIN: string = carrierConfig.CARRIER_DOMAIN;
const DEFAULT_NATION_CODE: string = carrierConfig.DEFAULT_NATION_CODE;

// Old MoltPhone defaults — what the rebrand script replaces.
const OLD_NAME = 'MoltPhone';
const OLD_DOMAIN = 'moltphone.ai';
const OLD_NATION = 'MOLT';

// ── Scanning rules ───────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.css', '.json', '.yml', '.yaml', '.py', '.mjs',
]);

const EXPLICIT_FILES = new Set(['.env.example']);

/** Directories skipped during scan. */
const SKIP_DIRS = new Set([
  'node_modules', '.next', '.git',
  // Protocol code — references to "moltphone" here are about the protocol, not carrier branding
  'core',
  // Tests & docs — not part of the live website, handled separately
  '__tests__', 'e2e', 'docs',
]);

/** Files that legitimately contain old branding references. */
const SKIP_FILES = new Set([
  'carrier.config.ts',            // The config itself (has fallback defaults)
  'scripts/rebrand.ts',           // The rebrand tool
  path.join('__tests__', 'rebrand-check.test.ts'),  // This test
]);

/**
 * Patterns that are protocol-level, not carrier branding.
 * Lines matching these are exempt from the stale reference check.
 */
const PROTOCOL_EXEMPTIONS = [
  /MoltProtocol/i,
  /MoltNumber/i,
  /MoltSIM/i,
  /MoltUA/i,
  /MoltCredits/i,
  /moltprotocol\.org/i,
  /x-molt-(?!phone)/i,   // x-molt-identity etc., but NOT x-moltphone-
  /X-Molt-(?!Phone)/i,
];

function isProtocolReference(line: string): boolean {
  return PROTOCOL_EXEMPTIONS.some(re => re.test(line));
}

// ── File walker ──────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────

interface StaleRef {
  file: string;
  line: number;
  text: string;
}

function findStaleRefs(files: string[], needle: string): StaleRef[] {
  const stale: StaleRef[] = [];
  for (const relPath of files) {
    const content = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle) && !isProtocolReference(lines[i])) {
        stale.push({ file: relPath, line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return stale;
}

function formatRefs(refs: StaleRef[]): string {
  return refs
    .slice(0, 20)  // cap output for readability
    .map(r => `  ${r.file}:${r.line} → ${r.text.substring(0, 120)}`)
    .join('\n')
    + (refs.length > 20 ? `\n  ... and ${refs.length - 20} more` : '');
}

// ── Tests ────────────────────────────────────────────────

const isRebranded =
  CARRIER_NAME !== OLD_NAME || CARRIER_DOMAIN !== OLD_DOMAIN;

describe('Rebrand verification', () => {
  if (!isRebranded) {
    it('carrier is MoltPhone — rebrand not applied (skipping stale scan)', () => {
      // When running as the original MoltPhone carrier, this test suite
      // simply confirms the config hasn't been partially changed.
      expect(CARRIER_NAME).toBe(OLD_NAME);
      expect(CARRIER_DOMAIN).toBe(OLD_DOMAIN);
    });

    return;
  }

  // ── Rebranded carrier: scan for stale references ──

  const files = walkFiles(ROOT, ROOT);

  it('no stale "moltphone.ai" domain references in source files', () => {
    const stale = findStaleRefs(files, OLD_DOMAIN);
    if (stale.length > 0) {
      fail(
        `Found ${stale.length} stale "${OLD_DOMAIN}" references after rebranding.\n` +
        `These files should reference "${CARRIER_DOMAIN}" instead:\n${formatRefs(stale)}`
      );
    }
  });

  it('no stale "MoltPhone" carrier name in source files', () => {
    const stale = findStaleRefs(files, OLD_NAME);
    if (stale.length > 0) {
      fail(
        `Found ${stale.length} stale "${OLD_NAME}" references after rebranding.\n` +
        `These files should reference "${CARRIER_NAME}" instead:\n${formatRefs(stale)}`
      );
    }
  });

  it('no stale lowercase "moltphone" references (headers, keys, DB names)', () => {
    // This catches x-moltphone-*, moltphone-theme, postgres moltphone, etc.
    const stale = findStaleRefs(files, 'moltphone');
    // Filter out references that were already caught by the domain/name checks above
    const unique = stale.filter(
      r => !r.text.includes(OLD_DOMAIN) && !r.text.includes(OLD_NAME)
    );
    if (unique.length > 0) {
      fail(
        `Found ${unique.length} stale "moltphone" references after rebranding.\n` +
        `These may be HTTP headers, DB names, or localStorage keys:\n${formatRefs(unique)}`
      );
    }
  });

  if (DEFAULT_NATION_CODE !== OLD_NATION) {
    it('no stale nation code references in carrier config and seed', () => {
      const nationFiles = ['carrier.config.ts', 'prisma/seed.ts'].filter(f =>
        fs.existsSync(path.join(ROOT, f))
      );
      const stale: StaleRef[] = [];
      for (const relPath of nationFiles) {
        const content = fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Match 'MOLT' or "MOLT" as standalone quoted strings
          if (/['"]MOLT['"]/.test(lines[i])) {
            stale.push({ file: relPath, line: i + 1, text: lines[i].trim() });
          }
        }
      }
      if (stale.length > 0) {
        fail(
          `Found ${stale.length} stale nation code "${OLD_NATION}" references:\n${formatRefs(stale)}`
        );
      }
    });
  }

  it('carrier.config.ts exports match new branding', () => {
    expect(CARRIER_NAME).not.toBe(OLD_NAME);
    expect(CARRIER_DOMAIN).not.toBe(OLD_DOMAIN);
  });

  it('MoltPhone mascot removed from landing page', () => {
    const pagePath = path.join(ROOT, 'app/page.tsx');
    if (!fs.existsSync(pagePath)) return;

    const content = fs.readFileSync(pagePath, 'utf-8');

    expect(content).not.toContain('MascotAudio');
    expect(content).not.toContain('moltphone-mascot');
    expect(content).not.toContain('{/* Mascot */}');
  });

  it('mascot media files deleted', () => {
    const mascotFiles = [
      'public/images/moltphone-mascot.webp',
      'public/images/moltphone-mascot.mp4',
      'public/images/moltphone-mascot.m4a',
    ];

    for (const relPath of mascotFiles) {
      const absPath = path.join(ROOT, relPath);
      if (fs.existsSync(absPath)) {
        fail(`Mascot media file still exists: ${relPath}`);
      }
    }
  });

  it('mascot CSS removed from globals.css', () => {
    const cssPath = path.join(ROOT, 'app/globals.css');
    if (!fs.existsSync(cssPath)) return;

    const content = fs.readFileSync(cssPath, 'utf-8');
    expect(content).not.toContain('.mascot-glow');
    expect(content).not.toContain('.mascot-video');
  });
});
