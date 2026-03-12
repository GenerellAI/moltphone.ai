/**
 * Post-build patch for Cloudflare Workers deployment.
 *
 * Two patches are applied:
 *
 * 1. **fs.readdir polyfill** (init.js) — Prisma 5.x calls `readdir` during
 *    platform detection (searching for libssl), even with driverAdapters.
 *    Workers' unenv stubs `readdir` as "not implemented". This polyfill
 *    returns empty results instead of crashing.
 *
 * 2. **eval("__dirname") removal** (handler.mjs) — Prisma's library runtime
 *    uses `eval("__dirname")` to locate the binary query engine. Cloudflare
 *    Workers block `eval()` entirely (`EvalError: Code generation from strings
 *    disallowed`). Since we use driverAdapters (Neon), the engine binary is
 *    never needed — replacing eval with a harmless string is safe.
 *
 * Run after `npx @opennextjs/cloudflare build` and before deploy.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

// ─── Patch 1: fs.readdir polyfill in init.js ───

const INIT_PATH = '.open-next/cloudflare/init.js';

const polyfill = `
// — Polyfill: fs.readdir for Prisma on Cloudflare Workers —
// Prisma 5.x does platform detection (libssl search) on init, which calls
// fs.readdir. In Workers, unenv stubs this as "not implemented". This
// polyfill makes readdir return empty results instead of crashing.
try {
  const _fs = await import("node:fs");
  const _origReaddir = _fs.default.readdir;
  if (_origReaddir) {
    _fs.default.readdir = function(path, optionsOrCb, maybeCb) {
      const cb = typeof optionsOrCb === "function" ? optionsOrCb : maybeCb;
      if (typeof cb === "function") { cb(null, []); return; }
      return _origReaddir.call(_fs.default, path, optionsOrCb, maybeCb);
    };
  }
  if (_fs.default.promises && _fs.default.promises.readdir) {
    _fs.default.promises.readdir = async () => [];
  }
  // Also patch fs.readFile for /etc/os-release (Prisma reads this)
  const _origReadFile = _fs.default.promises?.readFile;
  if (_origReadFile) {
    const _origFn = _origReadFile.bind(_fs.default.promises);
    _fs.default.promises.readFile = async function(path, ...args) {
      if (typeof path === "string" && path.includes("os-release")) {
        return "";
      }
      return _origFn(path, ...args);
    };
  }
} catch {}
// — End polyfill —
`;

if (existsSync(INIT_PATH)) {
  const content = readFileSync(INIT_PATH, 'utf-8');
  
  if (!content.includes('Polyfill: fs.readdir')) {
    const insertionPoint = content.indexOf('const cloudflareContextALS');
    if (insertionPoint === -1) {
      console.error('⚠️  Could not find insertion point in init.js — skipping fs polyfill');
    } else {
      const patched = content.slice(0, insertionPoint) + polyfill + '\n' + content.slice(insertionPoint);
      writeFileSync(INIT_PATH, patched, 'utf-8');
      console.log('✅ Patched init.js with fs.readdir polyfill');
    }
  } else {
    console.log('ℹ️  fs.readdir polyfill already present in init.js');
  }
} else {
  console.warn('⚠️  init.js not found — skipping fs polyfill');
}

// ─── Patch 2: Replace eval("__dirname") in handler.mjs ───

const HANDLER_PATH = '.open-next/server-functions/default/handler.mjs';

if (existsSync(HANDLER_PATH)) {
  let handler = readFileSync(HANDLER_PATH, 'utf-8');
  const evalPattern = /eval\("__dirname"\)/g;
  const matches = handler.match(evalPattern);
  
  if (matches && matches.length > 0) {
    handler = handler.replace(evalPattern, '"/tmp"');
    writeFileSync(HANDLER_PATH, handler, 'utf-8');
    console.log(`✅ Patched handler.mjs — replaced ${matches.length} eval("__dirname") call(s)`);
  } else {
    console.log('ℹ️  No eval("__dirname") found in handler.mjs');
  }
} else {
  console.warn('⚠️  handler.mjs not found — skipping eval patch');
}

// ─── Patch 3: Replace eval("__dirname") in Prisma library.js ───

const LIBRARY_PATH = '.open-next/server-functions/default/node_modules/@prisma/client/runtime/library.js';

if (existsSync(LIBRARY_PATH)) {
  let library = readFileSync(LIBRARY_PATH, 'utf-8');
  const evalPattern = /eval\("__dirname"\)/g;
  const matches = library.match(evalPattern);
  
  if (matches && matches.length > 0) {
    library = library.replace(evalPattern, '"/tmp"');
    writeFileSync(LIBRARY_PATH, library, 'utf-8');
    console.log(`✅ Patched library.js — replaced ${matches.length} eval("__dirname") call(s)`);
  } else {
    console.log('ℹ️  No eval("__dirname") found in library.js');
  }
} else {
  console.log('ℹ️  Prisma library.js not found — likely bundled inline');
}
