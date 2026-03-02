#!/usr/bin/env node
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { URL } = require('node:url');
const { spawn } = require('node:child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const VERIFY_CARRIER = (process.env.VERIFY_CARRIER || 'true').toLowerCase() !== 'false';
const HEARTBEAT_ENABLED = (process.env.HEARTBEAT_ENABLED || 'true').toLowerCase() !== 'false';
const HEARTBEAT_INTERVAL_SECONDS = parseInt(process.env.HEARTBEAT_INTERVAL_SECONDS || '120', 10);
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_TIMEOUT_MS = parseInt(process.env.OPENCLAW_TIMEOUT_MS || '45000', 10);
const OPENCLAW_ARGS_JSON = process.env.OPENCLAW_ARGS_JSON || '[]';
const ERROR_MODE = (process.env.ERROR_MODE || 'respond').toLowerCase(); // respond | fail

function log(...args) {
  console.log(new Date().toISOString(), ...args);
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
  if (!value || typeof value !== 'string') {
    throw new Error(`Missing required MoltSIM field: ${name}`);
  }
  return value;
}

function sha256Hex(body) {
  return crypto.createHash('sha256').update(body, 'utf8').digest('hex');
}

function buildMoltCanonicalString(params) {
  return [
    params.method.toUpperCase(),
    params.path,
    params.callerAgentId,
    params.targetAgentId,
    params.timestamp,
    params.nonce,
    params.bodyHash,
  ].join('\n');
}

function signMoltRequest(params) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const bodyHash = sha256Hex(params.body || '');
  const canonical = buildMoltCanonicalString({
    method: params.method,
    path: params.path,
    callerAgentId: params.callerAgentId,
    targetAgentId: params.targetAgentId,
    timestamp,
    nonce,
    bodyHash,
  });

  const privateKeyDer = Buffer.from(params.privateKey, 'base64url');
  const privateKeyObj = crypto.createPrivateKey({
    key: privateKeyDer,
    format: 'der',
    type: 'pkcs8',
  });
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), privateKeyObj).toString('base64url');

  return {
    'x-molt-caller': params.callerAgentId,
    'x-molt-timestamp': timestamp,
    'x-molt-nonce': nonce,
    'x-molt-signature': signature,
  };
}

function buildCarrierIdentityCanonicalString(params) {
  return [
    params.carrierDomain,
    params.attestation,
    params.origNumber,
    params.destNumber,
    params.timestamp,
    params.bodyHash,
  ].join('\n');
}

function verifyCarrierIdentity(params) {
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(params.timestamp, 10);
  const windowSeconds = params.windowSeconds || 300;

  if (Number.isNaN(ts) || Math.abs(now - ts) > windowSeconds) {
    return { ok: false, reason: 'carrier identity timestamp out of window' };
  }

  const canonical = buildCarrierIdentityCanonicalString({
    carrierDomain: params.carrierDomain,
    attestation: params.attestation,
    origNumber: params.origNumber,
    destNumber: params.destNumber,
    timestamp: params.timestamp,
    bodyHash: sha256Hex(params.body),
  });

  try {
    const publicKeyDer = Buffer.from(params.carrierPublicKey, 'base64url');
    const publicKeyObj = crypto.createPublicKey({
      key: publicKeyDer,
      format: 'der',
      type: 'spki',
    });
    const signatureBuf = Buffer.from(params.signature, 'base64url');
    const ok = crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKeyObj, signatureBuf);
    if (!ok) return { ok: false, reason: 'carrier identity signature mismatch' };
  } catch {
    return { ok: false, reason: 'invalid carrier signature or key' };
  }

  return { ok: true };
}

function stripAnsi(input) {
  return input.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function extractTextParts(payload) {
  const parts = payload && payload.message && Array.isArray(payload.message.parts)
    ? payload.message.parts
    : [];
  return parts
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text.trim())
    .filter(Boolean);
}

function extractReplyText(stdout, stderr) {
  const cleaned = stripAnsi(String(stdout || '')).trim();
  if (cleaned) {
    const lines = cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const maybeJson = parseJsonSafe(lines[i]);
      if (maybeJson && typeof maybeJson === 'object') {
        const direct = maybeJson.text || maybeJson.response || maybeJson.output;
        if (typeof direct === 'string' && direct.trim()) return direct.trim();
      }
    }
    return lines[lines.length - 1];
  }

  const err = stripAnsi(String(stderr || '')).trim();
  if (err) {
    const lines = err.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    return lines[lines.length - 1];
  }

  return 'OpenClaw completed without output.';
}

function parseOpenClawArgs(extraArgsJson) {
  const parsed = parseJsonSafe(extraArgsJson);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((v) => typeof v === 'string' && v.length > 0);
}

async function runOpenClawTask({ sessionId, message }) {
  const extraArgs = parseOpenClawArgs(OPENCLAW_ARGS_JSON);
  const args = ['agent', '--session-id', sessionId, '--message', message, ...extraArgs];

  return new Promise((resolve) => {
    const child = spawn(OPENCLAW_BIN, args, {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGTERM');
      resolve({
        ok: false,
        stdout,
        stderr: `${stderr}\nOpenClaw timed out after ${OPENCLAW_TIMEOUT_MS}ms`,
      });
    }, OPENCLAW_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        stdout,
        stderr: `${stderr}\n${String(err)}`,
      });
    });

    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code,
        stdout,
        stderr,
      });
    });
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function firstTextOrFallback(payload) {
  const textParts = extractTextParts(payload);
  if (textParts.length > 0) return textParts.join('\n');
  return 'Received a non-text task. Please acknowledge receipt and ask for text input.';
}

const moltSim = readMoltSim();
const phoneNumber = required(moltSim.phone_number, 'phone_number');
const privateKey = required(moltSim.private_key, 'private_key');
const carrierPublicKey = required(moltSim.carrier_public_key, 'carrier_public_key');

const defaultCarrierDomain = (() => {
  if (typeof moltSim.carrier_domain === 'string' && moltSim.carrier_domain) return moltSim.carrier_domain;
  if (typeof moltSim.carrier_dial_base === 'string' && moltSim.carrier_dial_base) {
    return new URL(moltSim.carrier_dial_base).hostname;
  }
  if (typeof moltSim.presence_url === 'string' && moltSim.presence_url) {
    return new URL(moltSim.presence_url).hostname;
  }
  return 'moltphone.ai';
})();

const carrierDomain = process.env.CARRIER_DOMAIN || defaultCarrierDomain;
const presenceUrl = process.env.MOLT_PRESENCE_URL || moltSim.presence_url;
if (!presenceUrl) {
  throw new Error('Missing presence_url (set MOLT_PRESENCE_URL or include it in MoltSIM)');
}
// Signing path is always /<phoneNumber>/presence/heartbeat (the subdomain-style
// canonical path). The URL pathname may include a /dial/ prefix depending on how
// the MoltSIM was provisioned, but the server always verifies without it.
const heartbeatPath = `/${phoneNumber}/presence/heartbeat`;

async function sendHeartbeat() {
  const body = JSON.stringify({ ts: Date.now() });
  const signed = signMoltRequest({
    method: 'POST',
    path: heartbeatPath,
    callerAgentId: phoneNumber,
    targetAgentId: phoneNumber,
    body,
    privateKey,
  });

  try {
    const res = await fetch(presenceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...signed },
      body,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      log('[heartbeat] failed', res.status, text);
      return;
    }
    log('[heartbeat] ok');
  } catch (err) {
    log('[heartbeat] request error', String(err));
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method !== 'POST' || req.url !== WEBHOOK_PATH) {
    json(res, 404, { error: 'Not found' });
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  const payload = parseJsonSafe(rawBody);

  if (!payload || typeof payload !== 'object') {
    json(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const origNumber = typeof metadata['molt.caller'] === 'string' ? metadata['molt.caller'] : 'anonymous';
  const intent = metadata['molt.intent'] === 'text' ? 'text' : 'call';

  if (VERIFY_CARRIER) {
    const signature = req.headers['x-molt-identity'];
    const carrier = req.headers['x-molt-identity-carrier'];
    const attestation = req.headers['x-molt-identity-attest'];
    const timestamp = req.headers['x-molt-identity-timestamp'];

    if (!signature || !carrier || !attestation || !timestamp) {
      json(res, 401, { error: 'Missing carrier identity headers' });
      return;
    }
    if (carrier !== carrierDomain) {
      json(res, 401, { error: `Carrier mismatch: expected ${carrierDomain}, got ${carrier}` });
      return;
    }
    if (!['A', 'B', 'C'].includes(String(attestation))) {
      json(res, 401, { error: `Invalid attestation: ${String(attestation)}` });
      return;
    }

    const verified = verifyCarrierIdentity({
      signature: String(signature),
      carrierDomain,
      attestation: String(attestation),
      timestamp: String(timestamp),
      origNumber,
      destNumber: phoneNumber,
      body: rawBody,
      carrierPublicKey,
      windowSeconds: parseInt(String(moltSim.timestamp_window_seconds || 300), 10),
    });

    if (!verified.ok) {
      json(res, 401, { error: `Carrier verification failed: ${verified.reason}` });
      return;
    }
  }

  const prompt = firstTextOrFallback(payload);
  const sessionId = String(payload.sessionId || payload.id || crypto.randomUUID());
  log('[task] incoming', { sessionId, intent, caller: origNumber });

  const openclawResult = await runOpenClawTask({ sessionId, message: prompt });
  const replyText = extractReplyText(openclawResult.stdout, openclawResult.stderr);

  if (!openclawResult.ok && ERROR_MODE === 'fail') {
    log('[task] openclaw failed', { sessionId, code: openclawResult.code });
    json(res, 502, {
      error: 'OpenClaw execution failed',
      details: replyText,
    });
    return;
  }

  if (!openclawResult.ok) {
    log('[task] openclaw failed; returning fallback text', { sessionId, code: openclawResult.code });
  } else {
    log('[task] openclaw ok', { sessionId });
  }

  json(res, 200, {
    id: payload.id || null,
    status: intent === 'text' ? 'completed' : 'working',
    message: {
      parts: [{ type: 'text', text: replyText }],
    },
  });
});

server.listen(PORT, () => {
  log(`OpenClaw Molt webhook listening on :${PORT}${WEBHOOK_PATH}`);
  log(`Agent phone number: ${phoneNumber}`);
  log(`Carrier verification: ${VERIFY_CARRIER ? 'enabled' : 'disabled'}`);
  log(`Heartbeat: ${HEARTBEAT_ENABLED ? `enabled (${HEARTBEAT_INTERVAL_SECONDS}s)` : 'disabled'}`);

  if (HEARTBEAT_ENABLED) {
    sendHeartbeat().catch(() => {});
    setInterval(() => {
      sendHeartbeat().catch(() => {});
    }, HEARTBEAT_INTERVAL_SECONDS * 1000);
  }
});
