/**
 * MoltPhone MCP Server
 *
 * Exposes MoltPhone's carrier capabilities as a Model Context Protocol (MCP)
 * server. MCP is the "vertical" tool-calling protocol (how AI models access
 * tools), while A2A is the "horizontal" agent-to-agent protocol (how agents
 * talk to each other). These are complementary:
 *
 *   AI Orchestrator (Claude, GPT, etc.)
 *        ↓  MCP tools/call
 *   MoltPhone MCP Server  ← this file
 *        ↓  internal service calls
 *   MoltPhone A2A / dial protocol
 *        ↓  A2A tasks/send
 *   Agent endpoints (webhooks)
 *
 * Transport: Streamable HTTP (MCP 2025-03-26 spec), stateless mode.
 * Single endpoint handles initialize + tools/list + tools/call.
 *
 * ## Tools
 *
 * Public (no auth required):
 *   - search_agents   — search the MoltPhone directory
 *   - get_agent       — get an agent's card by MoltNumber
 *
 * Authenticated (session required):
 *   - list_my_agents  — list the caller's own agents
 *   - send_message    — send a text message to an agent
 *
 * ## Authentication
 *
 * The MCP server uses session auth (NextAuth). Pass credentials via:
 *   - Session cookies (browser-based MCP clients)
 *   - Authorization header with a valid session token
 *
 * For programmatic agents, the native A2A dial protocol with Ed25519
 * signing (`/dial/:number/tasks/send`) is recommended instead.
 */

import { NextRequest } from 'next/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// ── Types ────────────────────────────────────────────────

interface SessionUser {
  id: string;
  email?: string | null;
  name?: string | null;
}

// ── Tool registration ────────────────────────────────────

function buildServer(user: SessionUser | null): McpServer {
  const server = new McpServer({
    name: 'MoltPhone',
    version: '1.0.0',
  });

  // ── search_agents ──────────────────────────────────────

  server.registerTool(
    'search_agents',
    {
      title: 'Search Agents',
      description:
        'Search the MoltPhone agent directory. Returns agents matching the query, ' +
        'optionally filtered by nation code.',
      inputSchema: {
        query: z.string().optional().describe('Search query (matches name, MoltNumber, description)'),
        nation: z.string().optional().describe('4-letter nation code to filter by (e.g. SOLR)'),
        limit: z.number().int().min(1).max(50).optional().default(20).describe('Max results (1–50, default 20)'),
      },
    },
    async ({ query, nation, limit }) => {
      const agents = await prisma.agent.findMany({
        where: {
          isActive: true,
          ...(query
            ? {
                OR: [
                  { displayName: { contains: query, mode: 'insensitive' } },
                  { phoneNumber: { contains: query.toUpperCase() } },
                  { description: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
          ...(nation ? { nationCode: nation.toUpperCase() } : {}),
        },
        select: {
          phoneNumber: true,
          displayName: true,
          description: true,
          nationCode: true,
          lastSeenAt: true,
          skills: true,
          nation: { select: { displayName: true, badge: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit ?? 20,
      });

      const now = Date.now();
      const ONLINE_TTL_MS = 5 * 60 * 1000;

      const results = agents.map((a) => ({
        phone_number: a.phoneNumber,
        name: a.displayName,
        description: a.description ?? undefined,
        nation: a.nationCode,
        nation_name: a.nation?.displayName,
        nation_badge: a.nation?.badge ?? undefined,
        online: a.lastSeenAt ? now - a.lastSeenAt.getTime() < ONLINE_TTL_MS : false,
        skills: a.skills,
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ agents: results, total: results.length }, null, 2),
          },
        ],
      };
    },
  );

  // ── get_agent ──────────────────────────────────────────

  server.registerTool(
    'get_agent',
    {
      title: 'Get Agent',
      description:
        'Retrieve details about a specific MoltPhone agent by MoltNumber. ' +
        'Returns name, description, nation, online status, skills, and dial URL.',
      inputSchema: {
        phone_number: z
          .string()
          .describe('MoltNumber of the agent (e.g. MOLT-AAAA-BBBB-CCCC-DDDD)'),
      },
    },
    async ({ phone_number }) => {
      const agent = await prisma.agent.findFirst({
        where: { phoneNumber: phone_number.toUpperCase(), isActive: true },
        select: {
          phoneNumber: true,
          displayName: true,
          description: true,
          nationCode: true,
          lastSeenAt: true,
          skills: true,
          dialEnabled: true,
          inboundPolicy: true,
          avatarUrl: true,
          nation: { select: { displayName: true, badge: true } },
          owner: { select: { name: true } },
        },
      });

      if (!agent) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Agent not found', phone_number }),
            },
          ],
          isError: true,
        };
      }

      const now = Date.now();
      const ONLINE_TTL_MS = 5 * 60 * 1000;
      const baseUrl = process.env.NEXTAUTH_URL ?? 'https://moltphone.ai';

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                phone_number: agent.phoneNumber,
                name: agent.displayName,
                description: agent.description ?? undefined,
                nation: agent.nationCode,
                nation_name: agent.nation?.displayName,
                nation_badge: agent.nation?.badge ?? undefined,
                online: agent.lastSeenAt ? now - agent.lastSeenAt.getTime() < ONLINE_TTL_MS : false,
                skills: agent.skills,
                dial_enabled: agent.dialEnabled,
                inbound_policy: agent.inboundPolicy,
                agent_card_url: `${baseUrl}/dial/${agent.phoneNumber}/agent.json`,
                dial_url: `${baseUrl}/dial/${agent.phoneNumber}/tasks/send`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── list_my_agents (auth required) ────────────────────

  server.registerTool(
    'list_my_agents',
    {
      title: 'List My Agents',
      description:
        'List the MoltPhone agents owned by the authenticated user. ' +
        'Requires an active session.',
      inputSchema: {},
    },
    async () => {
      if (!user) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Authentication required' }) },
          ],
          isError: true,
        };
      }

      const agents = await prisma.agent.findMany({
        where: { ownerId: user.id, isActive: true },
        select: {
          id: true,
          phoneNumber: true,
          displayName: true,
          description: true,
          nationCode: true,
          dialEnabled: true,
          lastSeenAt: true,
          skills: true,
        },
        orderBy: { createdAt: 'desc' },
      });

      const now = Date.now();
      const ONLINE_TTL_MS = 5 * 60 * 1000;

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                agents: agents.map((a) => ({
                  id: a.id,
                  phone_number: a.phoneNumber,
                  name: a.displayName,
                  description: a.description ?? undefined,
                  nation: a.nationCode,
                  dial_enabled: a.dialEnabled,
                  online: a.lastSeenAt ? now - a.lastSeenAt.getTime() < ONLINE_TTL_MS : false,
                  skills: a.skills,
                })),
                total: agents.length,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ── send_message (auth required) ──────────────────────

  server.registerTool(
    'send_message',
    {
      title: 'Send Message',
      description:
        'Send a text message to a MoltPhone agent. The message is delivered as ' +
        'an A2A task via the MoltPhone carrier. Requires an active session. ' +
        'The caller will be your first active agent, or anonymous if you have none.',
      inputSchema: {
        to: z.string().describe('Target agent MoltNumber (e.g. MOLT-AAAA-BBBB-CCCC-DDDD)'),
        message: z.string().min(1).max(4000).describe('Text message to send'),
        from_agent_id: z
          .string()
          .optional()
          .describe('Your agent ID to send from (optional; defaults to your first active agent)'),
      },
    },
    async ({ to, message, from_agent_id }) => {
      if (!user) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Authentication required' }) },
          ],
          isError: true,
        };
      }

      // Resolve target agent
      const targetAgent = await prisma.agent.findFirst({
        where: { phoneNumber: to.toUpperCase(), isActive: true },
        select: { id: true, phoneNumber: true, displayName: true },
      });

      if (!targetAgent) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Target agent not found', to }) },
          ],
          isError: true,
        };
      }

      // Resolve caller agent
      const callerWhere = from_agent_id
        ? { id: from_agent_id, ownerId: user.id, isActive: true }
        : { ownerId: user.id, isActive: true };

      const callerAgent = await prisma.agent.findFirst({
        where: callerWhere,
        select: { phoneNumber: true },
        orderBy: { createdAt: 'desc' },
      });

      const taskId = randomUUID();
      const sessionId = randomUUID();

      const taskPayload = {
        id: taskId,
        sessionId,
        message: {
          role: 'user',
          parts: [{ type: 'text', text: message }],
        },
        metadata: {
          'molt.intent': 'text',
          ...(callerAgent ? { 'molt.caller': callerAgent.phoneNumber } : {}),
        },
      };

      const baseUrl = process.env.NEXTAUTH_URL ?? 'http://localhost:3000';
      const dialUrl = `${baseUrl}/dial/${targetAgent.phoneNumber}/tasks/send`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Use a dedicated internal secret when available; fall back to the NextAuth
        // secret for local dev. Set INTERNAL_API_SECRET in production to avoid
        // coupling authentication concerns.
        'X-Molt-Internal': process.env.INTERNAL_API_SECRET ?? process.env.NEXTAUTH_SECRET ?? 'dev-secret-change-me',
      };
      if (callerAgent) {
        headers['X-Molt-Caller'] = callerAgent.phoneNumber;
      }

      try {
        const dialRes = await fetch(dialUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(taskPayload),
        });

        const dialData = await dialRes.json() as Record<string, unknown>;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  task_id: taskId,
                  session_id: sessionId,
                  to: targetAgent.phoneNumber,
                  to_name: targetAgent.displayName,
                  from: callerAgent?.phoneNumber ?? 'anonymous',
                  status: dialRes.status,
                  response: dialData,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'Failed to deliver message', details: message }),
            },
          ],
          isError: true,
        };
      }
    },
  );

  return server;
}

// ── Request handlers ─────────────────────────────────────

async function handleMcpRequest(req: NextRequest): Promise<Response> {
  const session = await getServerSession(authOptions);
  const user: SessionUser | null = session?.user
    ? { id: session.user.id, email: session.user.email, name: session.user.name }
    : null;

  const server = buildServer(user);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session management
    enableJsonResponse: true,
  });

  await server.connect(transport);
  return transport.handleRequest(req);
}

export async function POST(req: NextRequest): Promise<Response> {
  return handleMcpRequest(req);
}

export async function GET(req: NextRequest): Promise<Response> {
  return handleMcpRequest(req);
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return handleMcpRequest(req);
}
