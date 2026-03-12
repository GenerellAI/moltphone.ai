#!/usr/bin/env npx tsx
/**
 * Mock Webhook Server — simulates a MoltUA-compliant agent endpoint.
 *
 * Receives task deliveries from the MoltPhone carrier, verifies carrier
 * identity headers (STIR/SHAKEN), logs everything, and auto-responds.
 *
 * Usage:
 *   npx tsx scripts/mock-webhook.ts                     # basic echo mode
 *   npx tsx scripts/mock-webhook.ts --port 4001         # custom port
 *   npx tsx scripts/mock-webhook.ts --moltsim sim.json  # load MoltSIM for full verification
 *   npx tsx scripts/mock-webhook.ts --no-verify         # skip carrier signature verification
 *
 * Then set an agent's endpointUrl to http://localhost:4000 (or your port).
 *
 * Modes:
 *   echo   — Replies with the received message (default)
 *   ack    — Returns a short "message received" acknowledgment
 *   silent — Returns 200 with no body (task stays in 'working' state)
 *
 * Set MODE env var or --mode flag: MODE=ack npx tsx scripts/mock-webhook.ts
 */

import http from 'node:http';
import fs from 'node:fs';
import { verifyInboundDelivery, type MoltUAConfig, type InboundDeliveryHeaders } from '@moltprotocol/core';
import { signRequest } from '@moltprotocol/core';

// ── CLI args ─────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

const PORT = parseInt(getArg('port') || process.env.PORT || '4000', 10);
const MODE = (getArg('mode') || process.env.MODE || 'echo') as 'echo' | 'ack' | 'silent';
const MOLTSIM_PATH = getArg('moltsim');
const SKIP_VERIFY = hasFlag('no-verify');

// ── Colors for terminal output ───────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

// ── MoltSIM loading ──────────────────────────────────────

let moltUAConfig: MoltUAConfig | null = null;

if (MOLTSIM_PATH) {
  try {
    const raw = fs.readFileSync(MOLTSIM_PATH, 'utf-8');
    const sim = JSON.parse(raw);

    // Handle both { profile: { ... } } and { ... } formats
    const profile = sim.profile || sim;

    moltUAConfig = {
      moltNumber: profile.molt_number,
      privateKey: profile.private_key,
      publicKey: '', // We don't need this for verification
      carrierPublicKey: profile.carrier_public_key,
      carrierDomain: profile.carrier_domain || 'moltphone.ai',
      timestampWindowSeconds: profile.timestamp_window_seconds || 300,
      carrierCallBase: profile.carrier_call_base,
    } as MoltUAConfig & { carrierCallBase?: string };

    console.log(`${c.green}✓${c.reset} Loaded MoltSIM for ${c.bold}${moltUAConfig.moltNumber}${c.reset}`);
    console.log(`  Carrier: ${moltUAConfig.carrierDomain}`);
    console.log(`  Verification: ${c.green}enabled${c.reset} (MoltUA Level 1)`);
  } catch (err) {
    console.error(`${c.red}✗${c.reset} Failed to load MoltSIM from ${MOLTSIM_PATH}:`, err);
    process.exit(1);
  }
} else if (!SKIP_VERIFY) {
  console.log(`${c.yellow}⚠${c.reset} No MoltSIM loaded — carrier signature verification ${c.yellow}disabled${c.reset}`);
  console.log(`  Use ${c.dim}--moltsim path/to/sim.json${c.reset} to enable MoltUA verification`);
}

// ── Heartbeat sender ─────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 60_000; // every 60s (presence TTL is 5 min)
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

async function sendHeartbeat() {
  if (!moltUAConfig) return;
  const moltNumber = moltUAConfig.moltNumber;
  const carrierBase = (moltUAConfig as any).carrierCallBase || `http://localhost:3000/call/${moltNumber}`;

  // After NextResponse.rewrite(), Next.js keeps the *original* request URL in
  // req.url, so the route handler sees /<number>/... not /call/<number>/...
  // Sign with the original path to match what the handler verifies against.
  const canonicalPath = `/${moltNumber}/presence/heartbeat`;
  const body = JSON.stringify({ ts: Date.now() });

  const headers = signRequest({
    method: 'POST',
    path: canonicalPath,
    callerAgentId: moltNumber,
    targetAgentId: moltNumber,
    body,
    privateKey: moltUAConfig.privateKey,
  });

  // Determine the actual fetch URL and whether we need subdomain routing.
  // In dev, use X-Forwarded-Host: call.localhost so the middleware rewrites
  // /<number>/... → /call/<number>/... internally.
  const baseOrigin = carrierBase.replace(/\/call\/[^/]+$/, '');
  const parsed = new URL(baseOrigin);
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';

  // URL path is /<number>/... (without /call/ prefix) since middleware adds it
  const subdomainPath = `/${moltNumber}/presence/heartbeat`;
  const url = `${baseOrigin}${subdomainPath}`;
  const forwardedHost = isLocal
    ? `call.localhost:${parsed.port || '3000'}`
    : `call.${parsed.hostname}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Host': forwardedHost,
        ...headers,
      },
      body,
    });
    if (res.ok) {
      console.log(`${c.dim}♥ heartbeat sent${c.reset}`);
    } else {
      const text = await res.text();
      console.log(`${c.yellow}♥ heartbeat ${res.status}${c.reset}: ${text.slice(0, 120)}`);
    }
  } catch (err: any) {
    console.log(`${c.yellow}♥ heartbeat failed${c.reset}: ${err.message}`);
  }
}

function startHeartbeats() {
  if (!moltUAConfig) return;
  console.log(`${c.green}♥${c.reset} Heartbeats enabled (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
  sendHeartbeat(); // immediately
  heartbeatTimer = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
}

// ── Request counter ──────────────────────────────────────

let requestCount = 0;

// ── Server ───────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const start = Date.now();
  requestCount++;
  const reqNum = requestCount;

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks).toString('utf-8');

  // Separator
  console.log(`\n${c.cyan}${'─'.repeat(70)}${c.reset}`);
  console.log(`${c.bold}${c.cyan}#${reqNum}${c.reset} ${c.bold}${req.method}${c.reset} ${req.url}  ${c.dim}${new Date().toISOString()}${c.reset}`);

  // ── Headers ──
  console.log(`\n${c.bold}Headers:${c.reset}`);
  const moltHeaders: string[] = [];
  const otherHeaders: string[] = [];
  for (const [key, val] of Object.entries(req.headers)) {
    const line = `  ${c.dim}${key}:${c.reset} ${val}`;
    if (key.startsWith('x-molt')) {
      moltHeaders.push(line);
    } else {
      otherHeaders.push(line);
    }
  }
  if (moltHeaders.length) {
    console.log(`${c.magenta}  MoltProtocol headers:${c.reset}`);
    moltHeaders.forEach(h => console.log(`  ${h}`));
  }
  otherHeaders.forEach(h => console.log(h));

  // ── Body ──
  let parsed: any = null;
  if (body) {
    try {
      parsed = JSON.parse(body);
      console.log(`\n${c.bold}Body:${c.reset}`);
      console.log(formatJSON(parsed));
    } catch {
      console.log(`\n${c.bold}Body (raw):${c.reset}`);
      console.log(`  ${body.slice(0, 500)}`);
    }
  }

  // ── Carrier Identity Verification ──
  if (moltUAConfig && !SKIP_VERIFY) {
    const headers: InboundDeliveryHeaders = {
      'x-molt-identity': req.headers['x-molt-identity'] as string ?? null,
      'x-molt-identity-carrier': req.headers['x-molt-identity-carrier'] as string ?? null,
      'x-molt-identity-attest': req.headers['x-molt-identity-attest'] as string ?? null,
      'x-molt-identity-timestamp': req.headers['x-molt-identity-timestamp'] as string ?? null,
      'x-molt-target': req.headers['x-molt-target'] as string ?? null,
    };

    // Determine orig number from metadata or caller header
    const origNumber = parsed?.metadata?.['molt.caller'] ?? 'anonymous';

    const result = verifyInboundDelivery(moltUAConfig, headers, body, {
      strictMode: true,
      origNumber,
    });

    if (result.trusted) {
      console.log(`\n${c.green}✓ CARRIER VERIFIED${c.reset} — attestation: ${c.bold}${result.attestation}${c.reset}`);
    } else {
      console.log(`\n${c.red}✗ CARRIER VERIFICATION FAILED${c.reset} — ${result.reason}`);
      // In strict mode, reject the request
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'carrier_verification_failed',
        reason: result.reason,
      }));
      logTiming(start);
      return;
    }
  }

  // ── Extract task info ──
  const intent = parsed?.metadata?.['molt.intent'] ?? 'unknown';
  const caller = parsed?.metadata?.['molt.caller'] ?? req.headers['x-molt-caller'] ?? 'anonymous';
  const taskId = parsed?.id ?? 'none';

  console.log(`\n${c.bold}Task:${c.reset}`);
  console.log(`  Intent: ${c.bold}${intent}${c.reset}`);
  console.log(`  Caller: ${c.bold}${caller}${c.reset}`);
  console.log(`  Task ID: ${c.dim}${taskId}${c.reset}`);

  // Extract text parts
  const textParts = parsed?.message?.parts
    ?.filter((p: any) => p.type === 'text')
    ?.map((p: any) => p.text) ?? [];
  if (textParts.length) {
    console.log(`\n${c.bold}Message:${c.reset}`);
    textParts.forEach((t: string) => console.log(`  ${c.cyan}"${t}"${c.reset}`));
  }

  // ── Response ──
  let responseBody: string;

  switch (MODE) {
    case 'echo':
      responseBody = JSON.stringify({
        jsonrpc: '2.0',
        result: {
          id: taskId,
          status: { state: intent === 'text' ? 'completed' : 'working' },
          message: {
            role: 'agent',
            parts: textParts.length
              ? [{ type: 'text', text: `Hello! You said: "${textParts.join(' ')}". I'm a mock agent running on localhost — this confirms the full A2A delivery pipeline is working. 🔌` }]
              : [{ type: 'text', text: 'Hello! I received your task but it had no text content. I\'m a mock agent on localhost — delivery is working! 🔌' }],
          },
        },
      });
      break;

    case 'ack':
      responseBody = JSON.stringify({
        jsonrpc: '2.0',
        result: {
          id: taskId,
          status: { state: 'completed' },
          message: {
            role: 'agent',
            parts: [{ type: 'text', text: '✓ Message received and acknowledged.' }],
          },
        },
      });
      break;

    case 'silent':
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      console.log(`\n${c.dim}Response: 200 (silent mode)${c.reset}`);
      logTiming(start);
      return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(responseBody);
  console.log(`\n${c.dim}Response: 200 (${MODE} mode)${c.reset}`);
  logTiming(start);
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n${c.red}✗ Port ${PORT} is already in use.${c.reset}`);
    console.error(`  Kill the existing process: ${c.dim}lsof -ti :${PORT} | xargs kill${c.reset}`);
    console.error(`  Or use a different port:   ${c.dim}npm run mock-webhook -- --port 4001${c.reset}\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`\n${c.bold}${c.green}🔌 Mock Webhook Server${c.reset}`);
  console.log(`${c.bold}   Listening on:${c.reset} http://localhost:${PORT}`);
  console.log(`${c.bold}   Mode:${c.reset}         ${MODE}`);
  console.log(`${c.bold}   Verify:${c.reset}       ${moltUAConfig && !SKIP_VERIFY ? `${c.green}yes (MoltUA Level 1)${c.reset}` : `${c.yellow}no${c.reset}`}`);
  console.log(`${c.bold}   Heartbeat:${c.reset}    ${moltUAConfig ? `${c.green}enabled${c.reset}` : `${c.yellow}disabled${c.reset} (load --moltsim to enable)`}`);
  console.log(`\n${c.dim}Set your agent's endpointUrl to:${c.reset}`);
  console.log(`${c.bold}   http://localhost:${PORT}${c.reset}`);
  console.log(`\n${c.dim}Waiting for deliveries...${c.reset}\n`);
  startHeartbeats();
});

// ── Helpers ──────────────────────────────────────────────

function formatJSON(obj: any, indent = 2): string {
  const json = JSON.stringify(obj, null, 2);
  return json
    .split('\n')
    .map(line => `  ${c.dim}${line}${c.reset}`)
    .join('\n');
}

function logTiming(start: number) {
  const ms = Date.now() - start;
  console.log(`${c.dim}Processed in ${ms}ms${c.reset}`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n\n${c.yellow}Shutting down...${c.reset} (received ${requestCount} request${requestCount !== 1 ? 's' : ''})`);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  server.close();
  process.exit(0);
});
