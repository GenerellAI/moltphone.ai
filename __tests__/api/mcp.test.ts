/**
 * Tests for /api/mcp — MoltPhone MCP server.
 *
 * Tests: MCP initialize, tools/list, tools/call (search_agents, get_agent,
 * list_my_agents, send_message).
 *
 * The McpServer + WebStandardStreamableHTTPServerTransport are loaded from
 * the real SDK (CJS build). Prisma and NextAuth are mocked.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  TEST_USER,
  buildRequest,
  buildMockAgent,
  mockSession,
  resetAgentCounter,
} from '../helpers/setup';

// ── Mocks ────────────────────────────────────────────────

const mockPrisma = {
  agent: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
};
jest.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({
  getServerSession: (...args: any[]) => mockGetServerSession(...args),
}));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));

// Import route AFTER mocks are set up
import { POST, GET, DELETE } from '../../app/api/mcp/route';

// ── Helpers ──────────────────────────────────────────────

/** Build an MCP JSON-RPC request */
function mcpRequest(method: string, params?: unknown, id: number | string = 1) {
  return buildRequest('POST', '/api/mcp', {
    body: { jsonrpc: '2.0', method, id, params },
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
  });
}

async function callMcp(method: string, params?: unknown): Promise<any> {
  const req = mcpRequest(method, params);
  const res = await POST(req);
  return res.json();
}

// ── Setup ────────────────────────────────────────────────

let originalFetch: typeof global.fetch;

beforeAll(() => {
  originalFetch = global.fetch;
});

afterEach(() => {
  jest.clearAllMocks();
  global.fetch = originalFetch;
  resetAgentCounter();
});

beforeEach(() => {
  mockGetServerSession.mockResolvedValue(null);
});

// ── Tests ────────────────────────────────────────────────

describe('MCP protocol basics', () => {
  it('responds to initialize', async () => {
    const body = await callMcp('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'test-client', version: '1.0' },
      capabilities: {},
    });

    expect(body.jsonrpc).toBe('2.0');
    expect(body.result?.serverInfo?.name).toBe('MoltPhone');
    expect(body.result?.serverInfo?.version).toBe('1.0.0');
  });

  it('lists tools', async () => {
    const body = await callMcp('tools/list');

    const names = body.result?.tools?.map((t: any) => t.name) ?? [];
    expect(names).toContain('search_agents');
    expect(names).toContain('get_agent');
    expect(names).toContain('list_my_agents');
    expect(names).toContain('send_message');
  });

  it('GET request is handled (SSE capability)', async () => {
    const req = buildRequest('GET', '/api/mcp', {
      headers: { Accept: 'text/event-stream' },
    });
    const res = await GET(req);
    // In stateless mode the transport does not maintain SSE streams.
    // A 405 (method not allowed) or 200 (empty SSE) are both valid outcomes.
    expect([200, 405]).toContain(res.status);
  });

  it('DELETE request is handled', async () => {
    const req = buildRequest('DELETE', '/api/mcp', {});
    const res = await DELETE(req);
    expect([200, 405]).toContain(res.status);
  });
});

describe('tool: search_agents', () => {
  it('returns a list of agents', async () => {
    const agents = [buildMockAgent(), buildMockAgent()];
    mockPrisma.agent.findMany.mockResolvedValue(agents);

    const body = await callMcp('tools/call', {
      name: 'search_agents',
      arguments: { query: 'Test', limit: 10 },
    });

    expect(body.result?.isError).toBeFalsy();
    const text = body.result?.content?.[0]?.text;
    const parsed = JSON.parse(text);
    expect(parsed.agents).toHaveLength(2);
    expect(parsed.agents[0]).toHaveProperty('phone_number');
    expect(parsed.agents[0]).toHaveProperty('name');
    expect(parsed.total).toBe(2);
  });

  it('works with no query params (public, no auth)', async () => {
    mockPrisma.agent.findMany.mockResolvedValue([]);

    const body = await callMcp('tools/call', { name: 'search_agents', arguments: {} });

    expect(body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.agents).toHaveLength(0);
  });

  it('marks online agents correctly', async () => {
    const recentAgent = buildMockAgent({ lastSeenAt: new Date() });
    const staleAgent = buildMockAgent({ lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) });
    mockPrisma.agent.findMany.mockResolvedValue([recentAgent, staleAgent]);

    const body = await callMcp('tools/call', { name: 'search_agents', arguments: {} });
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.agents[0].online).toBe(true);
    expect(parsed.agents[1].online).toBe(false);
  });
});

describe('tool: get_agent', () => {
  it('returns agent details for a known number', async () => {
    const agent = buildMockAgent();
    mockPrisma.agent.findFirst.mockResolvedValue(agent);

    const body = await callMcp('tools/call', {
      name: 'get_agent',
      arguments: { phone_number: agent.phoneNumber },
    });

    expect(body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.phone_number).toBe(agent.phoneNumber);
    expect(parsed.name).toBe(agent.displayName);
    expect(parsed).toHaveProperty('agent_card_url');
    expect(parsed).toHaveProperty('dial_url');
  });

  it('returns an error for unknown number', async () => {
    mockPrisma.agent.findFirst.mockResolvedValue(null);

    const body = await callMcp('tools/call', {
      name: 'get_agent',
      arguments: { phone_number: 'MOLT-XXXX-XXXX-XXXX-XXXX' },
    });

    expect(body.result?.isError).toBe(true);
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.error).toBe('Agent not found');
  });
});

describe('tool: list_my_agents', () => {
  it('returns error when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const body = await callMcp('tools/call', { name: 'list_my_agents', arguments: {} });

    expect(body.result?.isError).toBe(true);
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.error).toBe('Authentication required');
  });

  it('returns agents for authenticated user', async () => {
    mockGetServerSession.mockResolvedValue(mockSession(TEST_USER));
    const agents = [buildMockAgent({ ownerId: TEST_USER.id })];
    mockPrisma.agent.findMany.mockResolvedValue(agents);

    const body = await callMcp('tools/call', { name: 'list_my_agents', arguments: {} });

    expect(body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.agents).toHaveLength(1);
    expect(parsed.agents[0]).toHaveProperty('id');
    expect(parsed.total).toBe(1);
  });
});

describe('tool: send_message', () => {
  it('returns error when not authenticated', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const body = await callMcp('tools/call', {
      name: 'send_message',
      arguments: { to: 'MOLT-AAAA-BBBB-CCCC-DDDD', message: 'Hello' },
    });

    expect(body.result?.isError).toBe(true);
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.error).toBe('Authentication required');
  });

  it('returns error when target agent not found', async () => {
    mockGetServerSession.mockResolvedValue(mockSession(TEST_USER));
    mockPrisma.agent.findFirst.mockResolvedValue(null); // target not found

    const body = await callMcp('tools/call', {
      name: 'send_message',
      arguments: { to: 'MOLT-XXXX-XXXX-XXXX-XXXX', message: 'Hello' },
    });

    expect(body.result?.isError).toBe(true);
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.error).toBe('Target agent not found');
  });

  it('sends a message to a target agent', async () => {
    mockGetServerSession.mockResolvedValue(mockSession(TEST_USER));

    const targetAgent = buildMockAgent();
    const callerAgent = buildMockAgent({ ownerId: TEST_USER.id });

    // First findFirst = target, second = caller
    mockPrisma.agent.findFirst
      .mockResolvedValueOnce(targetAgent)
      .mockResolvedValueOnce(callerAgent);

    // Mock the internal dial fetch
    const mockFetch = jest.fn().mockResolvedValue({
      json: async () => ({ result: { id: 'task-123', status: { state: 'submitted' } } }),
      status: 200,
    });
    global.fetch = mockFetch as any;

    const body = await callMcp('tools/call', {
      name: 'send_message',
      arguments: { to: targetAgent.phoneNumber, message: 'Hello from MCP!' },
    });

    expect(body.result?.isError).toBeFalsy();
    const parsed = JSON.parse(body.result?.content?.[0]?.text);
    expect(parsed.to).toBe(targetAgent.phoneNumber);
    expect(parsed.from).toBe(callerAgent.phoneNumber);
    expect(parsed).toHaveProperty('task_id');
    expect(parsed).toHaveProperty('session_id');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Verify the dial URL was called
    expect(mockFetch.mock.calls[0][0]).toContain(`/dial/${targetAgent.phoneNumber}/tasks/send`);
  });
});
