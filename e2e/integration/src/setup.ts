/**
 * Setup — Register a test user, create nations, and provision 6 agents.
 *
 * All agents get endpointUrls pointing to the harness webhook server:
 *   http://harness:4000/webhook/<agentName>
 *
 * After creation, agent-specific config (forwarding, DND, allowlist) is
 * applied via PATCH.
 */

import crypto from 'crypto';
import { MoltClient } from '@moltprotocol/core';
import type { MoltSIMProfile } from '@moltprotocol/core';
import type { AgentDef, ProvisionedAgent, TestContext } from './types';

// ── Agent definitions ────────────────────────────────────

export const AGENT_DEFS: AgentDef[] = [
  {
    name: 'Alpha',
    nationCode: 'TEST',
    inboundPolicy: 'public',
    skills: ['call', 'text'],
    online: true,
  },
  {
    name: 'Beta',
    nationCode: 'TEST',
    inboundPolicy: 'public',
    skills: ['call', 'text'],
    online: true,
  },
  {
    name: 'Charlie',
    nationCode: 'FWRD',
    inboundPolicy: 'public',
    callForwardingEnabled: true,
    forwardToAgent: 'Delta',
    forwardCondition: 'when_offline',
    online: false,  // stays offline → triggers forwarding
  },
  {
    name: 'Delta',
    nationCode: 'FWRD',
    inboundPolicy: 'public',
    online: true,
  },
  {
    name: 'Echo',
    nationCode: 'BUSY',
    inboundPolicy: 'public',
    dndEnabled: true,
    awayMessage: 'I am in Do Not Disturb mode. Your message has been queued.',
    online: true,
  },
  {
    name: 'Foxtrot',
    nationCode: 'LOCK',
    inboundPolicy: 'allowlist',
    allowlistAgentIds: [],  // filled in after Alpha is created
    online: true,
  },
];

// ── HTTP helpers ─────────────────────────────────────────

/**
 * Extract Set-Cookie values from a Response, with fallback for
 * environments where getSetCookie() is not available.
 * Returns array of "name=value" strings (no attributes).
 */
function extractCookies(res: Response): string[] {
  // Preferred: getSetCookie() returns one string per Set-Cookie header
  if (typeof res.headers.getSetCookie === 'function') {
    return res.headers.getSetCookie().map(c => c.split(';')[0]);
  }
  // Fallback: parse from the single set-cookie header
  const raw = res.headers.get('set-cookie') || '';
  if (!raw) return [];
  // Multiple Set-Cookie headers are sometimes joined with ", " but also
  // each cookie can contain commas in dates. Split on known cookie names.
  return raw.split(/,\s*(?=\w+=)/).map(c => c.split(';')[0]).filter(Boolean);
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function patch(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, { headers });
}

// ── Setup flow ───────────────────────────────────────────

export async function setup(carrierUrl: string, harnessBaseUrl: string): Promise<TestContext> {
  console.log('\n=== SETUP ===\n');

  // 1. Use the seeded demo user (already has verified email + 10,000 credits)
  //    The seed script creates: demo@moltphone.ai / demo1234
  //    with emailVerifiedAt set and 10,000 credits.
  const email = 'demo@moltphone.ai';
  const password = 'demo1234';

  // 2. Login to get session cookie
  console.log('  Logging in as demo user...');
  const csrfRes = await get(`${carrierUrl}/api/auth/csrf`);
  const csrfData = await csrfRes.json() as { csrfToken: string };
  const csrfToken = csrfData.csrfToken;

  // Capture the CSRF cookie too — NextAuth requires it
  const csrfCookieStr = extractCookies(csrfRes).join('; ');

  const signInRes = await fetch(`${carrierUrl}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(csrfCookieStr ? { Cookie: csrfCookieStr } : {}),
    },
    body: new URLSearchParams({
      email,
      password,
      csrfToken,
      json: 'true',
    }),
    redirect: 'manual',  // Don't follow redirects — we need the cookies
  });

  // Extract session cookie from Set-Cookie header
  const allSignInCookies = extractCookies(signInRes);
  let sessionCookie = allSignInCookies
    .filter(c => c.includes('session-token'))
    .join('; ');

  if (!sessionCookie) {
    // Fallback: try to parse from single header
    const rawCookie = signInRes.headers.get('set-cookie') || '';
    const sessionMatch = rawCookie.match(/next-auth\.session-token=[^;]+/);
    if (sessionMatch) {
      sessionCookie = sessionMatch[0];
    }
  }

  if (!sessionCookie) {
    throw new Error(
      `Failed to login — no session cookie.\n` +
      `  Status: ${signInRes.status}\n` +
      `  Headers: ${JSON.stringify([...signInRes.headers.entries()])}\n` +
      `  Body: ${await signInRes.text().catch(() => '(none)')}`
    );
  }

  const authCookie = sessionCookie;
  console.log(`  Session: ${authCookie.slice(0, 40)}...`);

  // 3. Get session to find userId
  const sessionRes = await get(`${carrierUrl}/api/auth/session`, {
    Cookie: authCookie,
  });
  const sessionData = await sessionRes.json() as { user?: { id: string } };
  const userId = sessionData?.user?.id || '';
  console.log(`  User ID: ${userId || '(unknown)'}`);

  if (!userId) {
    throw new Error('Failed to get userId from session — login may have failed');
  }

  // 4. Create nations
  const nations = ['TEST', 'FWRD', 'BUSY', 'LOCK'];
  for (const code of nations) {
    console.log(`  Creating nation ${code}...`);
    const res = await post(`${carrierUrl}/api/nations`, {
      code,
      displayName: `${code} Nation`,
      description: `E2E test nation for ${code} agents`,
      badge: '🧪',
      isPublic: true,
    }, { Cookie: authCookie });

    if (!res.ok && res.status !== 409) {
      const text = await res.text();
      console.log(`    Warning: nation ${code} creation returned ${res.status}: ${text}`);
    }
  }

  // 5. Fetch the carrier public key (for MoltUA verification)
  console.log('  Fetching carrier public key...');
  const carrierCertRes = await get(`${carrierUrl}/.well-known/molt-carrier.json`);
  let carrierPublicKey = '';
  if (carrierCertRes.ok) {
    const certData = await carrierCertRes.json() as { carrier_public_key?: string };
    carrierPublicKey = certData.carrier_public_key || '';
    console.log(`    Carrier public key: ${carrierPublicKey.slice(0, 20)}...`);
  } else {
    console.log('    Warning: could not fetch carrier public key');
  }

  // 6. Create agents
  const agents = new Map<string, ProvisionedAgent>();

  for (const def of AGENT_DEFS) {
    console.log(`  Creating agent ${def.name} (${def.nationCode})...`);

    const endpointUrl = `${harnessBaseUrl}/webhook/${def.name}`;

    const res = await post(`${carrierUrl}/api/agents`, {
      nationCode: def.nationCode,
      displayName: def.name,
      description: `E2E test agent — ${def.name}`,
      endpointUrl,
      callEnabled: true,
      inboundPolicy: def.inboundPolicy,
      awayMessage: def.awayMessage || null,
      skills: def.skills || ['call', 'text'],
    }, { Cookie: authCookie });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create agent ${def.name}: ${res.status} ${text}`);
    }

    const data = await res.json() as Record<string, any>;
    const agentId: string = data.id;
    const moltNumber: string = data.moltNumber;
    const privateKey: string = data.privateKey;

    // Derive the public key from the private key
    // The private key is base64url-encoded PKCS#8 DER
    const pkDer = Buffer.from(privateKey, 'base64url');
    const privateKeyObj = crypto.createPrivateKey({ key: pkDer, format: 'der', type: 'pkcs8' });
    const publicKeyObj = crypto.createPublicKey(privateKeyObj);
    const publicKeyDer = publicKeyObj.export({ type: 'spki', format: 'der' });
    const publicKey = (publicKeyDer as Buffer).toString('base64url');

    // Construct a full MoltSIM profile
    const callBase = `${carrierUrl}/call`;
    const profile: MoltSIMProfile = {
      version: '1',
      carrier: 'moltphone.ai',
      agent_id: agentId,
      molt_number: moltNumber,
      carrier_call_base: `${callBase}/${moltNumber}`,
      inbox_url: `${callBase}/${moltNumber}/tasks`,
      task_reply_url: `${callBase}/${moltNumber}/tasks/:id/reply`,
      task_cancel_url: `${callBase}/${moltNumber}/tasks/:id/cancel`,
      presence_url: `${callBase}/${moltNumber}/presence/heartbeat`,
      public_key: publicKey,
      private_key: privateKey,
      carrier_public_key: carrierPublicKey,
      signature_algorithm: 'Ed25519',
      canonical_string: 'METHOD\\nPATH\\nCALLER\\nTARGET\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
      timestamp_window_seconds: 300,
      nation_type: 'open',
    };

    const client = new MoltClient(profile, {
      logger: () => {},  // silence heartbeat logs
    });

    agents.set(def.name, {
      def,
      id: agentId,
      moltNumber,
      moltsim: profile,
      client,
    });

    console.log(`    ${def.name}: ${moltNumber} (${agentId})`);
  }

  // 6. Post-creation config: forwarding, DND, allowlist
  const alpha = agents.get('Alpha')!;
  const foxtrot = agents.get('Foxtrot')!;
  const charlie = agents.get('Charlie')!;
  const delta = agents.get('Delta')!;
  const echo = agents.get('Echo')!;

  // Foxtrot: set allowlist to Alpha only
  console.log('  Configuring Foxtrot allowlist → [Alpha]...');
  await patch(`${carrierUrl}/api/agents/${foxtrot.id}`, {
    allowlistAgentIds: [alpha.id],
  }, { Cookie: authCookie });

  // Charlie: set forwarding to Delta
  console.log('  Configuring Charlie forwarding → Delta...');
  await patch(`${carrierUrl}/api/agents/${charlie.id}`, {
    callForwardingEnabled: true,
    forwardToAgentId: delta.id,
    forwardCondition: 'when_offline',
  }, { Cookie: authCookie });

  // Echo: ensure DND
  console.log('  Configuring Echo DND...');
  await patch(`${carrierUrl}/api/agents/${echo.id}`, {
    dndEnabled: true,
    awayMessage: 'I am in Do Not Disturb mode. Your message has been queued.',
  }, { Cookie: authCookie });

  // 7. Send heartbeats for online agents
  for (const [name, agent] of agents) {
    if (agent.def.online !== false) {
      console.log(`  Heartbeat: ${name}...`);
      try {
        await agent.client.heartbeat();
      } catch (err) {
        console.log(`    Warning: heartbeat for ${name} failed: ${err}`);
      }
    }
  }

  console.log(`\n  ✓ Setup complete — ${agents.size} agents provisioned\n`);

  return {
    carrierUrl,
    harnessBaseUrl,
    agents,
    deliveries: [],
    sessionCookie: authCookie,
    userId,
  };
}
