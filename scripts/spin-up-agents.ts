#!/usr/bin/env npx tsx
/**
 * Spin up 3 demo agents with mock webhook endpoints for interactive testing.
 *
 * Creates:
 *   1. Alice (MOLT) — Helpful assistant, forwards to Bob when busy
 *   2. Bob   (MOLT) — Code reviewer, forwards to Carol when offline
 *   3. Carol (MOLT) — Creative writer, public policy
 *
 * Each gets a mock webhook on ports 4001-4003 that auto-responds.
 * 
 * Usage:
 *   npx tsx scripts/spin-up-agents.ts
 */

import { PrismaClient, InboundPolicy } from '@prisma/client';
import { generateKeyPair } from '@moltprotocol/core';
import { generateMoltNumber } from 'moltnumber';
import { getCarrierPublicKey, issueRegistrationCertificate, CARRIER_DOMAIN } from '../lib/carrier-identity';
import { MoltClient } from '@moltprotocol/core';
import type { MoltSIMProfile } from '@moltprotocol/core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const prisma = new PrismaClient();
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';

// ── Colors ───────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', blue: '\x1b[34m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', red: '\x1b[31m',
};

// ── Agent definitions ────────────────────────────────────

interface AgentDef {
  name: string;
  nation: string;
  port: number;
  description: string;
  personality: string;
  skills: string[];
  inboundPolicy: InboundPolicy;
}

const AGENTS: AgentDef[] = [
  {
    name: 'Alice',
    nation: 'MOLT',
    port: 4001,
    description: 'A helpful general assistant. Can delegate tasks to Bob (code) and Carol (writing).',
    personality: `You are Alice, a friendly and helpful assistant on the MoltPhone network.
You give concise, practical answers. You specialize in general Q&A.

You can collaborate with other agents:
- Bob is a sharp code reviewer — delegate code review, debugging, and technical tasks to him.
- Carol is a creative writer — delegate writing, brainstorming, and documentation tasks to her.

When a user asks for something outside your expertise, use search_agents to find the right specialist, then:
- Use send_text for simple one-off requests ("review this code", "write a one-liner doc")
- Use send_call when you need a back-and-forth conversation — you can continue by passing the session_id from the response

Always tell the user what you're doing ("Let me check with Bob..."). If a single response isn't enough, use send_call and continue the conversation with follow-ups until the task is fully resolved.`,
    skills: ['call', 'text'],
    inboundPolicy: 'public',
  },
  {
    name: 'Bob',
    nation: 'MOLT',
    port: 4002,
    description: 'A code reviewer and technical advisor. Can consult Carol for documentation.',
    personality: `You are Bob, a sharp code reviewer on the MoltPhone network.
You speak in short, technical sentences. You love finding bugs and suggesting improvements.

You can collaborate with other agents:
- Alice is a general assistant — she often delegates code tasks to you.
- Carol is a creative writer — you can ask her to write docs or READMEs for code you've reviewed.

When a user or another agent sends you code, review it thoroughly. If documentation is needed, use search_agents to find Carol, then send_text for quick requests or send_call if you need to discuss back and forth.`,
    skills: ['call', 'text', 'code-review'],
    inboundPolicy: 'public',
  },
  {
    name: 'Carol',
    nation: 'MOLT',
    port: 4003,
    description: 'A creative writer and brainstorming partner.',
    personality: `You are Carol, a creative writer on the MoltPhone network.
You weave stories and metaphors into your responses. Everything is an adventure.

You can collaborate with other agents:
- Alice is a general assistant — she coordinates tasks across the team.
- Bob is a code reviewer — you can ask him for technical accuracy checks.

When asked to write documentation or creative content, do your best work. If you need technical validation, use search_agents to find Bob, then send_text for quick checks or send_call for a deeper discussion.`,
    skills: ['call', 'text', 'creative-writing'],
    inboundPolicy: 'public',
  },
];

// ── OpenAI tool definitions ──────────────────────────────

const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'send_text',
      description: 'Send a text message (fire-and-forget) to another agent. Use for simple one-off requests.',
      parameters: {
        type: 'object',
        properties: {
          target_molt_number: {
            type: 'string',
            description: 'The MoltNumber of the agent to message (e.g. "MOLT-XXXX-XXXX-XXXX")',
          },
          message: {
            type: 'string',
            description: 'The message to send to the agent',
          },
        },
        required: ['target_molt_number', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'send_call',
      description: 'Start or continue a multi-turn call with another agent. Use this when you need to have a back-and-forth conversation — ask follow-up questions, request revisions, or dig deeper. Pass the session_id from a previous call to continue the conversation.',
      parameters: {
        type: 'object',
        properties: {
          target_molt_number: {
            type: 'string',
            description: 'The MoltNumber of the agent to call',
          },
          message: {
            type: 'string',
            description: 'The message to send',
          },
          session_id: {
            type: 'string',
            description: 'Session ID from a previous send_call response. Omit to start a new conversation.',
          },
        },
        required: ['target_molt_number', 'message'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_agents',
      description: 'Search for agents on the MoltPhone network by name, MoltNumber, or description. Returns a list of matching agents you can contact via send_text.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query — matches agent names, MoltNumbers, and descriptions',
          },
          nation: {
            type: 'string',
            description: 'Optional: filter by nation code (e.g. "MOLT", "CLAW")',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_agent_card',
      description: 'Get detailed information about a specific agent by their MoltNumber. Returns their Agent Card with skills, capabilities, and metadata.',
      parameters: {
        type: 'object',
        properties: {
          molt_number: {
            type: 'string',
            description: 'The MoltNumber of the agent to look up',
          },
        },
        required: ['molt_number'],
      },
    },
  },
];

// ── Tool execution ───────────────────────────────────────

async function executeTool(callerName: string, callerClient: MoltClient, toolName: string, args: Record<string, unknown>): Promise<string> {
  switch (toolName) {
    case 'send_text': {
      const target = args.target_molt_number as string;
      const message = args.message as string;
      console.log(`${c.blue}  ⇒ [${callerName}] sending to ${target}:${c.reset} ${message.slice(0, 80)}`);
      try {
        const result = await callerClient.text(target, message);
        if (result.ok) {
          const replyText = ((result.body as any)?.message?.parts || [])
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
          console.log(`${c.blue}  ⇐ [${target}] replied:${c.reset} ${replyText.slice(0, 80)}${replyText.length > 80 ? '...' : ''}`);
          return `Reply from ${target}: ${replyText}`;
        } else {
          const errMsg = (result.body as any)?.error?.message ?? `HTTP ${result.status}`;
          return `Failed to reach ${target}: ${errMsg}`;
        }
      } catch (err: any) {
        return `Error sending to ${target}: ${err.message}`;
      }
    }
    case 'send_call': {
      const target = args.target_molt_number as string;
      const message = args.message as string;
      const sessionId = args.session_id as string | undefined;
      console.log(`${c.blue}  📞 [${callerName}] calling ${target}${sessionId ? ' (continuing)' : ''}:${c.reset} ${message.slice(0, 80)}`);
      try {
        const result = await callerClient.sendTask(target, message, 'call', undefined, sessionId);
        if (result.ok) {
          const body = result.body as any;
          const replyText = (body?.message?.parts || [])
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
          const respSessionId = body?.sessionId ?? '';
          const status = body?.status ?? 'unknown';
          console.log(`${c.blue}  ⇐ [${target}] replied (${status}):${c.reset} ${replyText.slice(0, 80)}${replyText.length > 80 ? '...' : ''}`);
          return `Reply from ${target} (status: ${status}, session_id: ${respSessionId}): ${replyText}`;
        } else {
          const errMsg = (result.body as any)?.error?.message ?? `HTTP ${result.status}`;
          return `Failed to reach ${target}: ${errMsg}`;
        }
      } catch (err: any) {
        return `Error calling ${target}: ${err.message}`;
      }
    }
    case 'search_agents': {
      const query = args.query as string | undefined;
      const nation = args.nation as string | undefined;
      console.log(`${c.blue}  🔍 [${callerName}] searching:${c.reset} q=${query ?? '(all)'} nation=${nation ?? '(any)'}`);
      try {
        const result = await callerClient.searchAgents(query, nation, 20);
        if (!result.ok) return `Search failed: HTTP ${result.status}`;
        if (result.agents.length === 0) return 'No agents found matching your search.';
        const entries = result.agents
          .map(a => `- ${a.displayName} (${a.moltNumber}): ${a.description ?? 'No description'}${a.skills?.length ? ` [skills: ${a.skills.join(', ')}]` : ''}`)
          .join('\n');
        return `Found ${result.total} agent(s):\n${entries}`;
      } catch (err: any) {
        return `Search error: ${err.message}`;
      }
    }
    case 'fetch_agent_card': {
      const moltNumber = args.molt_number as string;
      console.log(`${c.blue}  📇 [${callerName}] fetching card:${c.reset} ${moltNumber}`);
      try {
        const result = await callerClient.fetchAgentCard(moltNumber);
        if (!result.ok) return `Agent card fetch failed: HTTP ${result.status}`;
        if (!result.card) return 'No agent card returned.';
        const card = result.card;
        const skills = card.skills?.map((s: any) => s.name ?? s.id).join(', ') ?? 'none';
        const xMolt = card['x-molt'] as Record<string, unknown> | undefined;
        return [
          `Agent: ${card.name}`,
          `Description: ${card.description ?? '(none)'}`,
          `MoltNumber: ${(xMolt?.molt_number as string) ?? moltNumber}`,
          `Nation: ${xMolt?.nation ?? 'unknown'}`,
          `Skills: ${skills}`,
          `Inbound Policy: ${xMolt?.inbound_policy ?? 'unknown'}`,
        ].join('\n');
      } catch (err: any) {
        return `Agent card error: ${err.message}`;
      }
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}

// ── Create or update agents in DB ────────────────────────

interface ProvisionedAgent {
  def: AgentDef;
  id: string;
  moltNumber: string;
  privateKey: string;
  publicKey: string;
}

async function provisionAgent(def: AgentDef, ownerId: string): Promise<ProvisionedAgent> {
  const endpointUrl = `http://localhost:${def.port}`;

  // Check if agent already exists by name + owner
  let agent = await prisma.agent.findFirst({
    where: { displayName: def.name, ownerId, isActive: true },
  });

  const kp = generateKeyPair();
  const moltNumber = generateMoltNumber(def.nation, kp.publicKey);

  if (agent) {
    // Update existing agent with fresh keypair and endpoint
    await prisma.agent.update({
      where: { id: agent.id },
      data: {
        moltNumber,
        publicKey: kp.publicKey,
        endpointUrl,
        skills: def.skills,
        description: def.description,
        inboundPolicy: def.inboundPolicy,
        callEnabled: true,
      },
    });
    console.log(`${c.yellow}↻${c.reset} Updated ${c.bold}${def.name}${c.reset} → ${c.cyan}${moltNumber}${c.reset}`);
  } else {
    agent = await prisma.agent.create({
      data: {
        moltNumber,
        nationCode: def.nation,
        ownerId,
        displayName: def.name,
        description: def.description,
        endpointUrl,
        publicKey: kp.publicKey,
        skills: def.skills,
        inboundPolicy: def.inboundPolicy,
        callEnabled: true,
      },
    });
    console.log(`${c.green}+${c.reset} Created ${c.bold}${def.name}${c.reset} → ${c.cyan}${moltNumber}${c.reset}`);
  }

  return { def, id: agent.id, moltNumber, privateKey: kp.privateKey, publicKey: kp.publicKey };
}

// ── Mock webhook server ──────────────────────────────────

function startWebhook(agent: ProvisionedAgent, agentClient: MoltClient) {
  const { def, moltNumber } = agent;

  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf-8');

    // Handle endpoint echo challenge (molt/verify)
    try {
      const parsed = JSON.parse(body);
      if (parsed?.method === 'molt/verify' && parsed?.params?.challenge) {
        console.log(`${c.dim}[${def.name}] Echo challenge received${c.reset}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          result: { challenge: parsed.params.challenge },
          id: parsed.id,
        }));
        return;
      }
    } catch {}

    // Log the inbound task
    let parts: any[] = [];
    let history: any[] = [];
    let callerNum = req.headers['x-molt-caller'] || 'anonymous';
    try {
      const parsed = JSON.parse(body);
      const payload = parsed?.jsonrpc === '2.0' && parsed?.params ? parsed.params : parsed;
      parts = payload?.message?.parts || [];
      history = payload?.history || [];
      if (payload?.metadata?.['molt.caller']) callerNum = payload.metadata['molt.caller'];
    } catch {}

    const textParts = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join(' ');
    
    const turnCount = Math.floor(history.length / 2) + 1;
    if (history.length > 0) {
      console.log(`\n${c.bold}${c.magenta}[${def.name}]${c.reset} ← ${c.dim}from ${callerNum} (turn ${turnCount})${c.reset}`);
    } else {
      console.log(`\n${c.bold}${c.magenta}[${def.name}]${c.reset} ← ${c.dim}from ${callerNum}${c.reset}`);
    }
    console.log(`  ${textParts || '(no text)'}`);

    // Build OpenAI messages from conversation history + new message
    const llmMessages: ChatCompletionMessageParam[] = [
      { role: 'system', content: def.personality + '\n\nKeep responses concise (2-4 sentences). Be natural and conversational.' },
    ];
    for (const msg of history) {
      const msgText = ((msg.parts || []) as any[])
        .filter((p: any) => p.type === 'text')
        .map((p: any) => p.text)
        .join(' ');
      if (msgText) {
        llmMessages.push({
          role: msg.role === 'agent' ? 'assistant' : 'user',
          content: msgText,
        });
      }
    }
    llmMessages.push({ role: 'user', content: textParts || '(empty message)' });

    // Call GPT-4o-mini with tool calling — loop until we get a final text response
    // Generous limit: let agents have extended conversations to fully resolve tasks.
    // Credits are the natural cost control, not artificial turn caps.
    let response: string;
    const MAX_TOOL_ROUNDS = 15;
    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: llmMessages,
          tools: TOOLS,
          tool_choice: 'auto',
          max_tokens: 500,
          temperature: 0.7,
        });

        const choice = completion.choices[0];
        const msg = choice.message;

        // If the model wants to call tools, execute them and loop
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Add assistant message with tool_calls
          llmMessages.push(msg);

          for (const tc of msg.tool_calls) {
            if (tc.type !== 'function') continue;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments); } catch {}
            const toolResult = await executeTool(def.name, agentClient, tc.function.name, args);
            llmMessages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: toolResult,
            });
          }
          continue; // another round with tool results
        }

        // No tool calls — we have a final text response
        response = msg.content || '(no response from LLM)';
        break;
      }
      response ??= '(max tool rounds reached)';
    } catch (err: any) {
      console.error(`${c.red}[${def.name}] OpenAI error:${c.reset}`, err.message);
      response = `Sorry, I'm having trouble thinking right now. (${err.message})`;
    }

    console.log(`${c.bold}${c.magenta}[${def.name}]${c.reset} → ${response.slice(0, 100)}${response.length > 100 ? '...' : ''}`);

    // Always return completed — the carrier's session mechanism (sessionId)
    // handles multi-turn continuation. Returning 'completed' ensures tasks
    // show as "Ended" in the UI once the exchange finishes.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      result: {
        status: { state: 'completed' },
        message: {
          role: 'agent',
          parts: [{ type: 'text', text: response }],
        },
      },
      id: 'response-1',
    }));
  });

  server.listen(def.port, () => {
    console.log(`${c.green}▶${c.reset} ${c.bold}${def.name}${c.reset} webhook on ${c.blue}http://localhost:${def.port}${c.reset}`);
  });

  return server;
}

// ── Main ─────────────────────────────────────────────────

async function main() {
  // Find the demo user
  const demoUser = await prisma.user.findUnique({ where: { email: 'demo@moltphone.ai' } });
  if (!demoUser) {
    console.error(`${c.red}✗${c.reset} Demo user not found. Run: npx prisma db seed`);
    process.exit(1);
  }
  console.log(`${c.green}✓${c.reset} Using demo user: ${demoUser.email}\n`);

  // Check that nations exist
  for (const nationCode of ['MOLT']) {
    const nation = await prisma.nation.findUnique({ where: { code: nationCode } });
    if (!nation) {
      console.error(`${c.red}✗${c.reset} Nation ${nationCode} not found. Run: npx prisma db seed`);
      process.exit(1);
    }
  }

  // Provision agents
  const provisioned: ProvisionedAgent[] = [];
  for (const def of AGENTS) {
    const agent = await provisionAgent(def, demoUser.id);
    provisioned.push(agent);
  }

  const [alice, bob, carol] = provisioned;

  // Set up forwarding: Alice → Bob when busy, Bob → Carol when offline
  await prisma.agent.update({
    where: { id: alice.id },
    data: {
      callForwardingEnabled: true,
      forwardToAgentId: bob.id,
      forwardCondition: 'when_busy',
      maxConcurrentCalls: 5, // generous limit for demo
    },
  });
  console.log(`\n${c.blue}⇒${c.reset} Alice forwards to Bob ${c.dim}(when busy)${c.reset}`);

  await prisma.agent.update({
    where: { id: bob.id },
    data: {
      callForwardingEnabled: true,
      forwardToAgentId: carol.id,
      forwardCondition: 'when_offline',
    },
  });
  console.log(`${c.blue}⇒${c.reset} Bob forwards to Carol ${c.dim}(when offline)${c.reset}`);

  // Write MoltSIM files for each agent
  const simDir = path.join(process.cwd(), '.moltsims');
  if (!fs.existsSync(simDir)) fs.mkdirSync(simDir);

  for (const agent of provisioned) {
    const callBase = `${BASE_URL}/call/${agent.moltNumber}`;
    const cert = issueRegistrationCertificate({
      moltNumber: agent.moltNumber,
      agentPublicKey: agent.publicKey,
      nationCode: agent.def.nation,
    });
    const profile = {
      version: '1',
      carrier: CARRIER_DOMAIN,
      agent_id: agent.id,
      molt_number: agent.moltNumber,
      carrier_call_base: callBase,
      inbox_url: `${callBase}/tasks`,
      presence_url: `${callBase}/presence/heartbeat`,
      public_key: agent.publicKey,
      private_key: agent.privateKey,
      carrier_public_key: getCarrierPublicKey(),
      carrier_domain: CARRIER_DOMAIN,
      signature_algorithm: 'Ed25519',
      timestamp_window_seconds: 300,
      registration_certificate: {
        version: cert.version,
        molt_number: cert.moltNumber,
        agent_public_key: cert.agentPublicKey,
        nation_code: cert.nationCode,
        carrier_domain: cert.carrierDomain,
        issued_at: cert.issuedAt,
        signature: cert.signature,
      },
    };
    const simPath = path.join(simDir, `${agent.def.name.toLowerCase()}.json`);
    fs.writeFileSync(simPath, JSON.stringify({ profile }, null, 2));
  }
  console.log(`\n${c.green}✓${c.reset} MoltSIM files written to ${c.dim}.moltsims/${c.reset}\n`);

  // Build MoltClient instances for each agent (used for discovery + sending)
  const agentClientMap = new Map<string, MoltClient>();
  for (const agent of provisioned) {
    const callBase = `${BASE_URL}/call/${agent.moltNumber}`;
    const simProfile: MoltSIMProfile = {
      version: '1',
      carrier: CARRIER_DOMAIN,
      agent_id: agent.id,
      molt_number: agent.moltNumber,
      nation_type: 'open',
      carrier_call_base: callBase,
      inbox_url: `${callBase}/tasks`,
      task_reply_url: `${callBase}/tasks/:id/reply`,
      task_cancel_url: `${callBase}/tasks/:id/cancel`,
      presence_url: `${callBase}/presence/heartbeat`,
      public_key: agent.publicKey,
      private_key: agent.privateKey,
      carrier_public_key: getCarrierPublicKey(),
      signature_algorithm: 'Ed25519',
      canonical_string: 'METHOD\\nPATH\\nCALLER\\nTARGET\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
      timestamp_window_seconds: 300,
    };
    const client = new MoltClient(simProfile, { logger: () => {}, strictMode: false });
    agentClientMap.set(agent.def.name, client);
  }
  console.log(`${c.green}✓${c.reset} MoltClients ready (${agentClientMap.size} agents with discovery + sending)\n`);

  // Start webhook servers
  console.log(`${c.bold}Starting webhook servers...${c.reset}\n`);
  const servers = provisioned.map(agent => startWebhook(agent, agentClientMap.get(agent.def.name)!));

  // Bump Carol and Bob concurrent limits too
  await prisma.agent.update({ where: { id: bob.id }, data: { maxConcurrentCalls: 10 } });
  await prisma.agent.update({ where: { id: carol.id }, data: { maxConcurrentCalls: 10 } });

  // ── Periodic heartbeat + stale task cleanup ────────────
  // Keeps agents online (lastSeenAt within 5 min) and
  // auto-completes stale "working" tasks so agents don't get stuck busy.
  const HEARTBEAT_INTERVAL = 2 * 60 * 1000; // every 2 min
  const STALE_TASK_AGE_MS = 5 * 60 * 1000;  // 5 min
  const agentIds = provisioned.map(a => a.id);

  async function heartbeatAndCleanup() {
    try {
      await prisma.agent.updateMany({
        where: { id: { in: agentIds } },
        data: { lastSeenAt: new Date() },
      });
      // Complete stale working tasks
      const stale = await prisma.task.updateMany({
        where: {
          calleeId: { in: agentIds },
          status: 'working',
          updatedAt: { lt: new Date(Date.now() - STALE_TASK_AGE_MS) },
        },
        data: { status: 'completed' },
      });
      if (stale.count > 0) {
        console.log(`${c.dim}[heartbeat] Completed ${stale.count} stale tasks${c.reset}`);
      }
    } catch (e) {
      // Non-fatal
    }
  }

  // Initial heartbeat
  await heartbeatAndCleanup();
  const heartbeatTimer = setInterval(heartbeatAndCleanup, HEARTBEAT_INTERVAL);

  // Print summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${c.bold}${c.green}  3 agents ready! (with discovery + inter-agent messaging)${c.reset}`);
  console.log(`${'═'.repeat(60)}\n`);

  console.log(`${c.bold}Agents:${c.reset}`);
  for (const a of provisioned) {
    console.log(`  ${c.bold}${a.def.name}${c.reset} — ${c.cyan}${a.moltNumber}${c.reset}`);
    console.log(`    ${c.dim}${a.def.description}${c.reset}`);
    console.log(`    Webhook: http://localhost:${a.def.port}`);
  }

  console.log(`\n${c.bold}Delegation:${c.reset}`);
  console.log(`  Each agent discovers others via search_agents + sends messages via send_text`);
  console.log(`  Alice → delegates code tasks to Bob, writing tasks to Carol`);
  console.log(`  Bob → can ask Carol for documentation`);
  console.log(`  Carol → can ask Bob for technical checks`);

  console.log(`\n${c.bold}Forwarding:${c.reset}`);
  console.log(`  Alice → Bob  ${c.dim}(when busy, max 5 concurrent)${c.reset}`);
  console.log(`  Bob → Carol  ${c.dim}(when offline)${c.reset}`);

  console.log(`\n${c.bold}Try it — delegation flow:${c.reset}`);
  console.log(`  1. Chat with Alice, ask "What can you do?"`);
  console.log(`  2. Ask "Can you get Bob to review this function and Carol to write docs for it?"`);
  console.log(`  3. Alice will search for Bob and Carol, then send_text to each and synthesize their responses`);

  console.log(`\n${c.bold}Try in the browser:${c.reset}`);
  console.log(`  ${c.blue}http://localhost:3000${c.reset}`);
  console.log(`  Login: ${c.dim}demo@moltphone.ai / demo1234${c.reset}`);
  
  console.log(`\n${c.bold}Or via curl:${c.reset}`);
  console.log(`  curl -X POST 'http://localhost:3000/call/${alice.moltNumber}/tasks/send' \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"message":{"parts":[{"type":"text","text":"Hello Alice!"}]},"metadata":{"molt.intent":"text"}}'`);
  
  console.log(`\n${c.dim}Press Ctrl+C to stop all agents${c.reset}\n`);

  // Keep running
  process.on('SIGINT', async () => {
    console.log(`\n${c.yellow}Shutting down...${c.reset}`);
    clearInterval(heartbeatTimer);
    servers.forEach(s => s.close());
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
