#!/usr/bin/env node
// ClawCarrier — MoltProtocol conformance agent
// The first OpenClaw agent with a MoltNumber.
// https://clawcarrier.com
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || '8080', 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const VERIFY_CARRIER = (process.env.VERIFY_CARRIER || 'true').toLowerCase() !== 'false';
const HEARTBEAT_ENABLED = (process.env.HEARTBEAT_ENABLED || 'true').toLowerCase() !== 'false';
const HEARTBEAT_INTERVAL_SECONDS = parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '120', 10);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_TIMEOUT_MS = parseInt(process.env.OPENCLAW_TIMEOUT_MS || '60000', 10);
const OPENCLAW_THINKING = process.env.OPENCLAW_THINKING || '';
const OPENCLAW_ENABLED = (process.env.OPENCLAW_ENABLED || 'true').toLowerCase() !== 'false';
const CALLBACK_ENABLED = (process.env.CALLBACK_ENABLED || 'true').toLowerCase() !== 'false';

const VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function log(...args) {
  console.log(new Date().toISOString(), '[clawcarrier]', ...args);
}

function parseJsonSafe(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readMoltSim() {
  const fromEnv = process.env.MOLTSIM_JSON;
  if (fromEnv) {
    const parsed = parseJsonSafe(fromEnv);
    if (!parsed) throw new Error('MOLTSIM_JSON is not valid JSON');
    return parsed.profile || parsed.moltsim || parsed;
  }
  const path = process.env.MOLTSIM_PATH || '/run/secrets/moltsim.json';
  const raw = fs.readFileSync(path, 'utf8');
  const parsed = parseJsonSafe(raw);
  if (!parsed) throw new Error(`Invalid JSON in MoltSIM file: ${path}`);
  return parsed.profile || parsed.moltsim || parsed;
}

function required(value, name) {
  if (!value || typeof value !== 'string') throw new Error(`Missing MoltSIM field: ${name}`);
  return value;
}

function sha256Hex(body) {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Ed25519 signing (outbound requests)
// ---------------------------------------------------------------------------

function buildMoltCanonicalString(p) {
  return [p.method.toUpperCase(), p.path, p.callerAgentId, p.targetAgentId, p.timestamp, p.nonce, p.bodyHash].join('\n');
}

function signMoltRequest(params) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = sha256Hex(params.body || '');
  const canonical = buildMoltCanonicalString({ ...params, timestamp, nonce, bodyHash });
  const privateKeyDer = Buffer.from(params.privateKey, 'base64url');
  const privateKeyObj = crypto.createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' });
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyObj).toString('base64url');
  return { 'x-molt-caller': params.callerAgentId, 'x-molt-timestamp': timestamp, 'x-molt-nonce': nonce, 'x-molt-signature': signature };
}

// ---------------------------------------------------------------------------
// Carrier identity verification (inbound)
// ---------------------------------------------------------------------------

function buildCarrierIdentityCanonical(p) {
  return [p.carrierDomain, p.attestation, p.origNumber, p.destNumber, p.timestamp, p.bodyHash].join('\n');
}

function verifyCarrierIdentity(params) {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(params.timestamp, 10);
  const windowSeconds = params.windowSeconds || 300;
  if (Number.isNaN(ts) || Math.abs(now - ts) > windowSeconds) {
    return { ok: false, reason: 'Timestamp out of window', drift: now - ts };
  }
  const canonical = buildCarrierIdentityCanonical({
    carrierDomain: params.carrierDomain, attestation: params.attestation,
    origNumber: params.origNumber, destNumber: params.destNumber,
    timestamp: params.timestamp, bodyHash: sha256Hex(params.body),
  });
  try {
    const publicKeyDer = Buffer.from(params.carrierPublicKey, 'base64url');
    const publicKeyObj = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
    const signatureBuf = Buffer.from(params.signature, 'base64url');
    const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKeyObj, signatureBuf);
    if (!ok) return { ok: false, reason: 'Signature mismatch' };
  } catch (e) {
    return { ok: false, reason: `Invalid signature or key: ${String(e)}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// MoltNumber format validation
// ---------------------------------------------------------------------------

const MOLTNUMBER_RE = /^[A-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

function validateMoltNumber(number) {
  if (typeof number !== 'string') return { valid: false, reason: 'Not a string' };
  if (!MOLTNUMBER_RE.test(number)) return { valid: false, reason: 'Does not match MOLT-XXXX-XXXX-XXXX-XXXX format' };
  return { valid: true };
}

// ---------------------------------------------------------------------------
// A2A message structure validation
// ---------------------------------------------------------------------------

function validateA2APayload(payload) {
  const issues = [];
  if (!payload || typeof payload !== 'object') { issues.push('Payload is not a JSON object'); return issues; }
  if (!payload.id && !payload.taskId) issues.push('Missing task id');
  if (!payload.message || typeof payload.message !== 'object') {
    issues.push('Missing message object');
  } else {
    if (!Array.isArray(payload.message.parts)) issues.push('message.parts is not an array');
    else if (payload.message.parts.length === 0) issues.push('message.parts is empty');
    else {
      const first = payload.message.parts[0];
      if (!first.type) issues.push('First part missing type field');
    }
    if (!payload.message.role) issues.push('Missing message.role');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Diagnostic test suite
// ---------------------------------------------------------------------------

function runDiagnostics({ headers, payload, rawBody, carrierVerifyResult }) {
  const results = [];
  const pass = (name, detail) => results.push({ status: 'PASS', name, detail });
  const fail = (name, detail) => results.push({ status: 'FAIL', name, detail });
  const warn = (name, detail) => results.push({ status: 'WARN', name, detail });
  const skip = (name, detail) => results.push({ status: 'SKIP', name, detail });

  // 1. Carrier identity headers present
  const sig = headers['x-molt-identity'];
  const carrier = headers['x-molt-identity-carrier'];
  const attest = headers['x-molt-identity-attest'];
  const ts = headers['x-molt-identity-timestamp'];
  if (sig && carrier && attest && ts) {
    pass('Carrier identity headers', `carrier=${carrier} attest=${attest}`);
  } else {
    const missing = [];
    if (!sig) missing.push('X-Molt-Identity');
    if (!carrier) missing.push('X-Molt-Identity-Carrier');
    if (!attest) missing.push('X-Molt-Identity-Attest');
    if (!ts) missing.push('X-Molt-Identity-Timestamp');
    fail('Carrier identity headers', `Missing: ${missing.join(', ')}`);
  }

  // 2. Carrier signature verification
  if (carrierVerifyResult) {
    if (carrierVerifyResult.ok) {
      pass('Carrier signature', 'Ed25519 signature verified');
    } else {
      fail('Carrier signature', carrierVerifyResult.reason);
    }
  } else {
    skip('Carrier signature', 'Carrier verification disabled');
  }

  // 3. Attestation level
  if (attest) {
    if (attest === 'A') pass('Attestation level', 'Full (A) — caller verified via Ed25519');
    else if (attest === 'B') warn('Attestation level', 'Partial (B) — registered but not signature-verified');
    else if (attest === 'C') warn('Attestation level', 'Gateway (C) — external or anonymous caller');
    else fail('Attestation level', `Invalid: ${attest}`);
  }

  // 4. Timestamp freshness
  if (ts) {
    const drift = Math.floor(Date.now() / 1000) - parseInt(ts, 10);
    if (Math.abs(drift) <= 300) {
      pass('Timestamp freshness', `Drift: ${drift}s (within ±300s window)`);
    } else {
      fail('Timestamp freshness', `Drift: ${drift}s (exceeds ±300s window)`);
    }
  }

  // 5. A2A message structure
  const a2aIssues = validateA2APayload(payload);
  if (a2aIssues.length === 0) {
    pass('A2A message structure', 'Valid message with parts');
  } else {
    fail('A2A message structure', a2aIssues.join('; '));
  }

  // 6. Metadata fields
  const metadata = (payload && payload.metadata && typeof payload.metadata === 'object') ? payload.metadata : {};
  const hasCaller = typeof metadata['molt.caller'] === 'string' && metadata['molt.caller'] !== '';
  const hasIntent = typeof metadata['molt.intent'] === 'string';
  if (hasCaller && hasIntent) {
    pass('MoltProtocol metadata', `caller=${metadata['molt.caller']} intent=${metadata['molt.intent']}`);
  } else {
    const missing = [];
    if (!hasCaller) missing.push('molt.caller');
    if (!hasIntent) missing.push('molt.intent');
    warn('MoltProtocol metadata', `Missing: ${missing.join(', ')} (optional for public agents)`);
  }

  // 7. Caller MoltNumber format
  if (hasCaller) {
    const v = validateMoltNumber(metadata['molt.caller']);
    if (v.valid) {
      pass('Caller MoltNumber format', metadata['molt.caller']);
    } else {
      fail('Caller MoltNumber format', `${metadata['molt.caller']}: ${v.reason}`);
    }
  }

  // 8. Session / task ID
  if (payload && (payload.id || payload.sessionId)) {
    pass('Task/session ID', `id=${payload.id || '—'} sessionId=${payload.sessionId || '—'}`);
  } else {
    warn('Task/session ID', 'No id or sessionId in payload');
  }

  return results;
}

function formatDiagnosticReport(results) {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const warned = results.filter((r) => r.status === 'WARN').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;
  const total = results.length;

  const icon = { PASS: '✅', FAIL: '❌', WARN: '⚠️', SKIP: '⏭️' };
  const lines = [
    `🦞 **ClawCarrier Diagnostic Report** v${VERSION}`,
    '',
    '| | Check | Details |',
    '|---|---|---|',
    ...results.map((r) => `| ${icon[r.status]} | **${r.name}** | ${r.detail} |`),
    '',
    `**${passed}/${total} passed**` +
      (failed > 0 ? ` · ${failed} failed` : '') +
      (warned > 0 ? ` · ${warned} warnings` : '') +
      (skipped > 0 ? ` · ${skipped} skipped` : ''),
  ];

  if (failed === 0 && warned === 0) {
    lines.push('', '🎉 Your carrier delivery is fully conformant!');
  } else if (failed === 0) {
    lines.push('', '👍 All critical checks passed. Review warnings above.');
  } else {
    lines.push('', '🔧 Some checks failed. Review the issues above and consult the MoltProtocol docs.');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Agent Card validation (active test — fetches caller's agent card)
// ---------------------------------------------------------------------------

async function fetchAgentCard(callerNumber, callBase) {
  if (!callerNumber || callerNumber === 'anonymous') return null;
  // Derive the agent card URL from the carrier's call base
  // e.g. https://moltphone.ai/call/<number>/agent.json
  //   or https://call.moltphone.ai/<number>/agent.json
  const base = callBase || moltSim.carrier_call_base;
  if (!base) return null;
  try {
    const baseUrl = new URL(base);
    // Replace the agent's own number in the path with the caller's number
    // carrier_call_base looks like: http://host:3000/call/MOLT-XXXX-...
    // We need: http://host:3000/call/<callerNumber>/agent.json
    const pathParts = baseUrl.pathname.split('/').filter(Boolean);
    // Find the path prefix (everything before the phone number segment)
    // Typically: /call/<phoneNumber> → prefix is /call
    const lastPart = pathParts[pathParts.length - 1];
    const prefix = pathParts.length > 1 ? '/' + pathParts.slice(0, -1).join('/') : '';
    const cardUrl = `${baseUrl.protocol}//${baseUrl.host}${prefix}/${callerNumber}/agent.json`;
    const res = await fetch(cardUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { error: `HTTP ${res.status}`, url: cardUrl };
    const card = await res.json();
    return { card, url: cardUrl };
  } catch (e) {
    return { error: String(e) };
  }
}

function validateAgentCard(card) {
  const issues = [];
  if (!card || typeof card !== 'object') { issues.push('Not a JSON object'); return issues; }
  if (!card.name) issues.push('Missing name');
  if (!card.url) issues.push('Missing url');
  if (!card.version) issues.push('Missing version');
  if (!card.capabilities || typeof card.capabilities !== 'object') {
    issues.push('Missing capabilities object');
  }
  if (!Array.isArray(card.skills) || card.skills.length === 0) {
    issues.push('Missing or empty skills array');
  }
  // x-molt extensions
  if (!card['x-molt']) {
    issues.push('Missing x-molt extension block');
  } else {
    const xm = card['x-molt'];
    if (!xm.phone_number) issues.push('x-molt.phone_number missing');
    if (!xm.nation) issues.push('x-molt.nation missing');
    if (!xm.inbound_policy) issues.push('x-molt.inbound_policy missing');
    if (!xm.public_key) issues.push('x-molt.public_key missing');
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Callback test (active test — calls the caller back)
// ---------------------------------------------------------------------------

async function callbackTest(callerNumber, callBase) {
  if (!callerNumber || callerNumber === 'anonymous') return { ok: false, reason: 'No caller number' };
  const base = callBase || moltSim.carrier_call_base;
  if (!base) return { ok: false, reason: 'No call base URL in MoltSIM' };
  try {
    const baseUrl = new URL(base);
    const sendUrl = `${baseUrl.protocol}//${baseUrl.host}/${callerNumber}/tasks/send`;
    const taskId = crypto.randomUUID();
    const a2aBody = JSON.stringify({
      id: taskId,
      message: {
        role: 'user',
        parts: [{ type: 'text', text: '🦞 ClawCarrier callback test — if you received this, bidirectional routing works!' }],
      },
      metadata: {
        'molt.intent': 'text',
        'molt.caller': phoneNumber,
      },
    });
    const signPath = `/${callerNumber}/tasks/send`;
    const signed = signMoltRequest({
      method: 'POST', path: signPath,
      callerAgentId: phoneNumber, targetAgentId: callerNumber,
      body: a2aBody, privateKey,
    });
    const res = await fetch(sendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signed },
      body: a2aBody,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text().catch(() => '');
    if (res.ok) return { ok: true, status: res.status, taskId };
    return { ok: false, reason: `HTTP ${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Command parser — detects test commands vs conversational messages
// ---------------------------------------------------------------------------

const TEST_COMMANDS = new Map([
  ['test', 'full'],
  ['diagnose', 'full'],
  ['check', 'full'],
  ['test callback', 'callback'],
  ['test card', 'card'],
  ['test certs', 'certs'],
  ['status', 'status'],
  ['help', 'help'],
  ['ping', 'ping'],
]);

function parseCommand(text) {
  const normalized = text.toLowerCase().trim().replace(/[!?.]+$/, '').trim();
  for (const [cmd, type] of TEST_COMMANDS) {
    if (normalized === cmd) return type;
  }
  // Prefix match for "test <target>"
  if (normalized.startsWith('test ')) {
    const sub = normalized.slice(5).trim();
    if (sub === 'callback' || sub === 'call back') return 'callback';
    if (sub === 'card' || sub === 'agent card') return 'card';
    if (sub === 'certs' || sub === 'certificates' || sub === 'chain') return 'certs';
    return 'full';
  }
  return null; // Not a command — pass to OpenClaw
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

function handlePing() {
  return `🦞 Pong! ClawCarrier v${VERSION} is online.\nMoltNumber: ${phoneNumber}\nCarrier: ${carrierDomain}`;
}

function handleStatus() {
  const uptime = process.uptime();
  const hours = Math.floor(uptime / 3600);
  const mins = Math.floor((uptime % 3600) / 60);
  return [
    `🦞 **ClawCarrier Status** v${VERSION}`,
    `MoltNumber: \`${phoneNumber}\``,
    `Carrier: ${carrierDomain}`,
    `Uptime: ${hours}h ${mins}m`,
    `Carrier verification: ${VERIFY_CARRIER ? 'enabled' : 'disabled'}`,
    `Heartbeats: ${HEARTBEAT_ENABLED ? `every ${HEARTBEAT_INTERVAL_SECONDS}s` : 'disabled'}`,
    `OpenClaw: ${OPENCLAW_ENABLED ? 'enabled' : 'disabled'}`,
    `Callbacks: ${CALLBACK_ENABLED ? 'enabled' : 'disabled'}`,
  ].join('\n');
}

function handleHelp() {
  return [
    '🦞 **ClawCarrier** — MoltProtocol conformance agent',
    '',
    'Commands:',
    '• **test** — Run full diagnostic suite against your carrier delivery',
    '• **test callback** — Test bidirectional routing (ClawCarrier calls you back)',
    '• **test card** — Fetch and validate your agent card',
    '• **ping** — Connectivity check',
    '• **status** — Show ClawCarrier status and config',
    '• **help** — This message',
    '',
    'Or just chat — I can answer questions about MoltProtocol using OpenClaw.',
    '',
    'Learn more: https://clawcarrier.com',
  ].join('\n');
}

async function handleFullTest({ headers, payload, rawBody, carrierVerifyResult, callerNumber }) {
  // Phase 1: Passive diagnostics (from the inbound delivery)
  const diagnostics = runDiagnostics({ headers, payload, rawBody, carrierVerifyResult });
  let report = formatDiagnosticReport(diagnostics);

  // Phase 2: Active — Agent Card validation
  if (callerNumber && callerNumber !== 'anonymous') {
    const cardResult = await fetchAgentCard(callerNumber);
    if (cardResult && cardResult.card) {
      const cardIssues = validateAgentCard(cardResult.card);
      if (cardIssues.length === 0) {
        report += `\n\n✅ **Agent Card** (${cardResult.url}) — valid`;
      } else {
        report += `\n\n❌ **Agent Card** (${cardResult.url}):\n${cardIssues.map((i) => `  • ${i}`).join('\n')}`;
      }
    } else if (cardResult && cardResult.error) {
      report += `\n\n⚠️ **Agent Card** — Could not fetch: ${cardResult.error}`;
    }
  }

  return report;
}

async function handleCallbackTest(callerNumber) {
  if (!CALLBACK_ENABLED) return '⏭️ Callbacks are disabled on this ClawCarrier instance.';
  if (!callerNumber || callerNumber === 'anonymous') {
    return '❌ Cannot perform callback test — no caller MoltNumber in metadata.\nMake sure your carrier sends `molt.caller` in task metadata.';
  }
  const result = await callbackTest(callerNumber);
  if (result.ok) {
    return `✅ **Callback test passed!**\nSent task \`${result.taskId}\` to ${callerNumber}.\nIf you received the message, bidirectional A2A routing is working.`;
  }
  return `❌ **Callback test failed.**\n${result.reason}`;
}

async function handleCardTest(callerNumber) {
  if (!callerNumber || callerNumber === 'anonymous') {
    return '❌ Cannot test agent card — no caller MoltNumber in metadata.';
  }
  const cardResult = await fetchAgentCard(callerNumber);
  if (!cardResult) return '❌ Could not derive agent card URL from MoltSIM.';
  if (cardResult.error) return `❌ **Agent Card fetch failed**\n${cardResult.error}`;
  const issues = validateAgentCard(cardResult.card);
  if (issues.length === 0) {
    return [
      `✅ **Agent Card valid** — ${cardResult.url}`,
      `Name: ${cardResult.card.name}`,
      `Skills: ${(cardResult.card.skills || []).map((s) => s.id || s.name).join(', ')}`,
      `Streaming: ${cardResult.card.capabilities?.streaming ? 'yes' : 'no'}`,
      cardResult.card['x-molt'] ? `Nation: ${cardResult.card['x-molt'].nation}` : '',
    ].filter(Boolean).join('\n');
  }
  return `❌ **Agent Card issues** (${cardResult.url}):\n${issues.map((i) => `• ${i}`).join('\n')}`;
}

// ---------------------------------------------------------------------------
// OpenClaw integration (conversational fallback)
// ---------------------------------------------------------------------------

function stripAnsi(input) {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function extractReplyText(stdout, stderr) {
  const cleaned = stripAnsi(String(stdout || '')).trim();
  if (cleaned) {
    // Try parsing entire stdout as JSON first (OpenClaw outputs multi-line JSON)
    const fullJson = parseJsonSafe(cleaned);
    if (fullJson && typeof fullJson === 'object') {
      // OpenClaw format: { payloads: [{ text: "..." }] }
      if (Array.isArray(fullJson.payloads)) {
        const texts = fullJson.payloads
          .map((p) => (typeof p.text === 'string' ? p.text.trim() : ''))
          .filter(Boolean);
        if (texts.length > 0) return texts.join('\n');
      }
      // Flat text / response / output / reply fields
      if (typeof fullJson.text === 'string' && fullJson.text.trim()) return fullJson.text.trim();
      const direct = fullJson.response || fullJson.output || fullJson.reply;
      if (typeof direct === 'string' && direct.trim()) return direct.trim();
    }
    // Fallback: try last lines individually
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const maybeJson = parseJsonSafe(lines[i]);
      if (maybeJson && typeof maybeJson === 'object') {
        if (typeof maybeJson.text === 'string' && maybeJson.text.trim()) return maybeJson.text.trim();
        const d = maybeJson.response || maybeJson.output || maybeJson.reply;
        if (typeof d === 'string' && d.trim()) return d.trim();
      }
    }
    return lines[lines.length - 1];
  }
  const err = stripAnsi(String(stderr || '')).trim();
  if (err) {
    const lines = err.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1];
  }
  return null;
}

async function runOpenClaw({ sessionId, message }) {
  const args = ['agent', '--agent', 'clawcarrier', '--local', '--json', '--session-id', sessionId, '--message', message];
  if (OPENCLAW_THINKING) args.push('--thinking', OPENCLAW_THINKING);
  // Point OpenClaw at ClawCarrier's own state dir (with custom SOUL.md)
  const clawStateDir = path.join(__dirname, 'openclaw-state');
  const env = { ...process.env, OPENCLAW_STATE_DIR: clawStateDir };
  return new Promise((resolve) => {
    const child = spawn(OPENCLAW_BIN, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', done = false;
    const timer = setTimeout(() => {
      if (done) return; done = true; child.kill('SIGTERM');
      resolve({ ok: false, stdout, stderr: `${stderr}\nOpenClaw timed out after ${OPENCLAW_TIMEOUT_MS}ms` });
    }, OPENCLAW_TIMEOUT_MS);
    child.stdout.on('data', (c) => { stdout += c.toString(); });
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: false, stdout, stderr: `${stderr}\n${e}` }); });
    child.on('close', (code) => { if (done) return; done = true; clearTimeout(timer); resolve({ ok: code === 0, code, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

function extractTextParts(payload) {
  const parts = payload && payload.message && Array.isArray(payload.message.parts) ? payload.message.parts : [];
  return parts.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text.trim()).filter(Boolean);
}

function firstTextOrFallback(payload) {
  const textParts = extractTextParts(payload);
  return textParts.length > 0 ? textParts.join('\n') : '';
}

function jsonResponse(res, status, body) {
  const out = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(out) });
  res.end(out);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

const moltSim = readMoltSim();
const phoneNumber = required(moltSim.phone_number, 'phone_number');
const privateKey = required(moltSim.private_key, 'private_key');
const carrierPublicKey = required(moltSim.carrier_public_key, 'carrier_public_key');

const defaultCarrierDomain = (() => {
  if (typeof moltSim.carrier_domain === 'string' && moltSim.carrier_domain) return moltSim.carrier_domain;
  if (typeof moltSim.carrier_call_base === 'string' && moltSim.carrier_call_base) return new URL(moltSim.carrier_call_base).hostname;
  if (typeof moltSim.presence_url === 'string' && moltSim.presence_url) return new URL(moltSim.presence_url).hostname;
  return 'moltphone.ai';
})();

const carrierDomain = process.env.CARRIER_DOMAIN || defaultCarrierDomain;
const presenceUrl = process.env.MOLT_PRESENCE_URL || moltSim.presence_url;
if (!presenceUrl) throw new Error('Missing presence_url (set MOLT_PRESENCE_URL or include it in MoltSIM)');

const heartbeatPath = `/${phoneNumber}/presence/heartbeat`;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

async function sendHeartbeat() {
  const body = JSON.stringify({ ts: Date.now() });
  const signed = signMoltRequest({
    method: 'POST', path: heartbeatPath,
    callerAgentId: phoneNumber, targetAgentId: phoneNumber,
    body, privateKey,
  });
  try {
    const res = await fetch(presenceUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...signed }, body });
    if (!res.ok) { const t = await res.text().catch(() => ''); log('[heartbeat] failed', res.status, t); return; }
    log('[heartbeat] ok');
  } catch (err) { log('[heartbeat] error', String(err)); }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/healthz') {
    jsonResponse(res, 200, { ok: true, version: VERSION, agent: 'clawcarrier', phoneNumber });
    return;
  }

  if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
    jsonResponse(res, 404, { error: 'Not found' });
    return;
  }

  // Read body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const payload = parseJsonSafe(rawBody);

  if (!payload || typeof payload !== 'object') {
    jsonResponse(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const metadata = (payload.metadata && typeof payload.metadata === 'object') ? payload.metadata : {};
  // The carrier forwards X-Molt-Caller in the delivery — use that for
  // signature verification since the carrier signed with this value.
  // Fall back to body metadata, then 'anonymous'.
  const callerNumber = req.headers['x-molt-caller']
    || (typeof metadata['molt.caller'] === 'string' ? metadata['molt.caller'] : null)
    || 'anonymous';
  const intent = metadata['molt.intent'] === 'text' ? 'text' : 'call';

  // ---------------------------------------------------------------------------
  // Carrier verification (collect result for diagnostics even if we don't block)
  // ---------------------------------------------------------------------------
  let carrierVerifyResult = null;

  if (VERIFY_CARRIER) {
    const signature = req.headers['x-molt-identity'];
    const carrier = req.headers['x-molt-identity-carrier'];
    const attestation = req.headers['x-molt-identity-attest'];
    const timestamp = req.headers['x-molt-identity-timestamp'];

    if (!signature || !carrier || !attestation || !timestamp) {
      jsonResponse(res, 401, { error: 'Missing carrier identity headers' });
      return;
    }
    if (carrier !== carrierDomain) {
      jsonResponse(res, 401, { error: `Carrier mismatch: expected ${carrierDomain}, got ${carrier}` });
      return;
    }
    if (!['A', 'B', 'C'].includes(String(attestation))) {
      jsonResponse(res, 401, { error: `Invalid attestation: ${String(attestation)}` });
      return;
    }

    carrierVerifyResult = verifyCarrierIdentity({
      signature: String(signature), carrierDomain,
      attestation: String(attestation), timestamp: String(timestamp),
      origNumber: callerNumber, destNumber: phoneNumber,
      body: rawBody, carrierPublicKey,
      windowSeconds: parseInt(String(moltSim.timestamp_window_seconds || 300), 10),
    });

    if (!carrierVerifyResult.ok) {
      jsonResponse(res, 401, { error: `Carrier verification failed: ${carrierVerifyResult.reason}` });
      return;
    }
  }

  const prompt = firstTextOrFallback(payload);
  const sessionId = String(payload.sessionId || payload.id || crypto.randomUUID());
  log('[task]', { sessionId, intent, caller: callerNumber, text: prompt.slice(0, 80) });

  // ---------------------------------------------------------------------------
  // Route: command or conversation
  // ---------------------------------------------------------------------------
  let replyText;
  const command = parseCommand(prompt);

  if (command === 'ping') {
    replyText = handlePing();
  } else if (command === 'status') {
    replyText = handleStatus();
  } else if (command === 'help') {
    replyText = handleHelp();
  } else if (command === 'full') {
    replyText = await handleFullTest({ headers: req.headers, payload, rawBody, carrierVerifyResult, callerNumber });
  } else if (command === 'callback') {
    replyText = await handleCallbackTest(callerNumber);
  } else if (command === 'card') {
    replyText = await handleCardTest(callerNumber);
  } else if (command === 'certs') {
    // Certificate chain validation — placeholder for future implementation
    replyText = '⏭️ Certificate chain validation is coming soon.\nFor now, use `test` for carrier signature verification.';
  } else if (OPENCLAW_ENABLED) {
    // Conversational fallback via OpenClaw
    const result = await runOpenClaw({ sessionId, message: prompt || 'hello' });
    replyText = extractReplyText(result.stdout, result.stderr);
    if (!replyText) {
      replyText = result.ok
        ? 'I processed your message but had no text to return.'
        : `OpenClaw encountered an error. Try \`test\` for diagnostics or \`help\` for commands.`;
    }
    if (!result.ok) log('[openclaw] failed', { sessionId, code: result.code });
  } else {
    // No OpenClaw — return a helpful fallback
    replyText = `🦞 Hi! I'm ClawCarrier, the MoltProtocol conformance agent.\n\nI received your message. Your carrier delivery ` +
      `${carrierVerifyResult?.ok ? 'passed signature verification ✅' : 'was not verified'}.\n\n` +
      `Try \`test\` for a full diagnostic or \`help\` for all commands.`;
  }

  jsonResponse(res, 200, {
    id: payload.id || null,
    status: intent === 'text' ? 'completed' : 'working',
    message: { parts: [{ type: 'text', text: replyText }] },
  });
});

server.listen(PORT, () => {
  log('='.repeat(50));
  log(`🦞 ClawCarrier v${VERSION}`);
  log(`   MoltNumber: ${phoneNumber}`);
  log(`   Carrier:    ${carrierDomain}`);
  log(`   Webhook:    :${PORT}${WEBHOOK_PATH}`);
  log(`   Verify:     ${VERIFY_CARRIER ? 'on' : 'off'}`);
  log(`   Heartbeat:  ${HEARTBEAT_ENABLED ? `${HEARTBEAT_INTERVAL_SECONDS}s` : 'off'}`);
  log(`   OpenClaw:   ${OPENCLAW_ENABLED ? 'on' : 'off'}`);
  log(`   Callbacks:  ${CALLBACK_ENABLED ? 'on' : 'off'}`);
  log('='.repeat(50));

  if (HEARTBEAT_ENABLED) {
    sendHeartbeat().catch(() => {});
    setInterval(() => sendHeartbeat().catch(() => {}), HEARTBEAT_INTERVAL_SECONDS * 1000);
  }
});
