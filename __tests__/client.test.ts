/**
 * Tests for MoltClient — the MoltSIM client SDK.
 */

import crypto from 'crypto';
import {
  MoltClient,
  parseMoltSIM,
  type MoltClientOptions,
  type InboxTask,
  type AgentSummary,
  type AgentSearchResult,
  type AgentCardResult,
  type NumberLookupResult,
} from '@moltprotocol/core';
import {
  type MoltSIMProfile,
} from '@moltprotocol/core';
import {
  generateKeyPair,
  verifySignature,
} from '@moltprotocol/core';
import {
  signCarrierDelivery,
} from '@moltprotocol/core';

// ── Test Helpers ─────────────────────────────────────────

/** Generate a valid MoltSIM for testing. */
function createTestMoltSIM(overrides: Partial<MoltSIMProfile> = {}): MoltSIMProfile {
  const kp = generateKeyPair();
  const carrierKp = generateKeyPair();
  return {
    version: '1',
    carrier: 'moltphone.ai',
    agent_id: 'test-agent-id',
    molt_number: 'TEST-1234-5678-9ABC',
    carrier_call_base: 'https://moltphone.ai/call/TEST-1234-5678-9ABC',
    inbox_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks',
    task_reply_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/:id/reply',
    task_cancel_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/:id/cancel',
    presence_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/presence/heartbeat',
    public_key: kp.publicKey,
    private_key: kp.privateKey,
    carrier_public_key: carrierKp.publicKey,
    signature_algorithm: 'Ed25519',
    canonical_string: 'METHOD\\nPATH\\nCALLER\\nTARGET\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
    timestamp_window_seconds: 300,
    nation_type: 'open',
    ...overrides,
  };
}

/** Create a mock fetch that captures the last request and returns a preset response. */
function createMockFetch(response: {
  status?: number;
  ok?: boolean;
  body?: Record<string, unknown>;
} = {}) {
  const status = response.status ?? 200;
  const ok = response.ok ?? (status >= 200 && status < 300);
  const body = response.body ?? {};

  const calls: Array<{ url: string; init: RequestInit }> = [];

  const mockFetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    calls.push({ url: urlStr, init: init ?? {} });
    return {
      status,
      ok,
      json: async () => body,
      headers: new Headers({ 'content-type': 'application/json' }),
    } as Response;
  });

  return { mockFetch, calls };
}

// ── Constructor Tests ────────────────────────────────────

describe('MoltClient', () => {
  describe('constructor', () => {
    it('creates a client from a valid MoltSIM', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim);

      expect(client.moltNumber).toBe('TEST-1234-5678-9ABC');
      expect(client.carrier).toBe('moltphone.ai');
      expect(client.publicKey).toBe(sim.public_key);
      expect(client.carrierCallBase).toBe('https://moltphone.ai/call/TEST-1234-5678-9ABC');
      expect(client.isHeartbeatRunning).toBe(false);
    });

    it('strips trailing slashes from carrierCallBase', () => {
      const sim = createTestMoltSIM({
        carrier_call_base: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/',
      });
      const client = new MoltClient(sim);
      expect(client.carrierCallBase).toBe('https://moltphone.ai/call/TEST-1234-5678-9ABC');
    });

    it('throws when private_key is missing', () => {
      const sim = createTestMoltSIM();
      delete (sim as unknown as Record<string, unknown>).private_key;
      expect(() => new MoltClient(sim)).toThrow('private_key');
    });

    it('throws when molt_number is missing', () => {
      const sim = createTestMoltSIM({ molt_number: '' });
      expect(() => new MoltClient(sim)).toThrow('molt_number');
    });

    it('throws when carrier_call_base is missing', () => {
      const sim = createTestMoltSIM({ carrier_call_base: '' });
      expect(() => new MoltClient(sim)).toThrow('carrier_call_base');
    });
  });

  // ── sendTask / text / call ─────────────────────────────

  describe('sendTask', () => {
    it('sends a task with correct A2A JSON-RPC envelope', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch({
        status: 200,
        body: { jsonrpc: '2.0', result: { id: 'task-1', status: 'submitted' } },
      });
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.sendTask('DEST-AAAA-BBBB-CCCC', 'Hello!', 'call');

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://moltphone.ai/call/DEST-AAAA-BBBB-CCCC/tasks/send');

      // Verify body
      const body = JSON.parse(calls[0].init.body as string);
      expect(body.jsonrpc).toBe('2.0');
      expect(body.method).toBe('tasks/send');
      expect(body.params.message.role).toBe('user');
      expect(body.params.message.parts[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(body.params.metadata['molt.intent']).toBe('call');
      expect(body.params.metadata['molt.caller']).toBe('TEST-1234-5678-9ABC');
    });

    it('includes Ed25519 signature headers', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.sendTask('DEST-AAAA-BBBB-CCCC', 'Hi', 'text');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-molt-caller']).toBe('TEST-1234-5678-9ABC');
      expect(headers['x-molt-timestamp']).toBeDefined();
      expect(headers['x-molt-nonce']).toBeDefined();
      expect(headers['x-molt-signature']).toBeDefined();
    });

    it('generates valid Ed25519 signatures', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.sendTask('DEST-AAAA-BBBB-CCCC', 'Verify me', 'text');

      const headers = calls[0].init.headers as Record<string, string>;
      const body = calls[0].init.body as string;

      // Verify the signature with the agent's public key
      const result = verifySignature({
        method: 'POST',
        path: '/call/DEST-AAAA-BBBB-CCCC/tasks/send',
        callerAgentId: 'TEST-1234-5678-9ABC',
        targetAgentId: 'DEST-AAAA-BBBB-CCCC',
        body,
        publicKey: sim.public_key,
        timestamp: headers['x-molt-timestamp'],
        nonce: headers['x-molt-nonce'],
        signature: headers['x-molt-signature'],
        windowSeconds: 300,
      });

      expect(result.valid).toBe(true);
    });

    it('uses custom taskId if provided', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.sendTask('DEST-AAAA-BBBB-CCCC', 'Hi', 'text', 'custom-task-id');

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.id).toBe('custom-task-id');
    });
  });

  describe('text', () => {
    it('sends with intent=text', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.text('DEST-AAAA-BBBB-CCCC', 'Quick message');

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.metadata['molt.intent']).toBe('text');
    });
  });

  describe('call', () => {
    it('sends with intent=call', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.call('DEST-AAAA-BBBB-CCCC', 'Start conversation');

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.metadata['molt.intent']).toBe('call');
    });
  });

  describe('sendTaskParts', () => {
    it('sends custom message parts', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.sendTaskParts('DEST-AAAA-BBBB-CCCC', [
        { type: 'text', text: 'Here is data' },
        { type: 'data', data: { key: 'value' } },
      ], 'call');

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.message.parts).toHaveLength(2);
      expect(body.params.message.parts[0]).toEqual({ type: 'text', text: 'Here is data' });
      expect(body.params.message.parts[1]).toEqual({ type: 'data', data: { key: 'value' } });
    });
  });

  // ── reply ──────────────────────────────────────────────

  describe('reply', () => {
    it('replies to a task with correct URL and body', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.reply('task-abc', 'Thanks!');

      expect(calls[0].url).toBe(
        'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/task-abc/reply',
      );

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.id).toBe('task-abc');
      expect(body.params.message.role).toBe('agent');
      expect(body.params.message.parts[0].text).toBe('Thanks!');
    });

    it('signs reply requests', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.reply('task-abc', 'Signed reply');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-molt-signature']).toBeDefined();
      expect(headers['x-molt-caller']).toBe('TEST-1234-5678-9ABC');
    });
  });

  describe('replyParts', () => {
    it('replies with custom parts', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.replyParts('task-abc', [
        { type: 'text', text: 'See attached data' },
        { type: 'data', data: { report: { score: 95 } } },
      ]);

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.message.parts).toHaveLength(2);
      expect(body.params.message.role).toBe('agent');
    });
  });

  // ── cancel ─────────────────────────────────────────────

  describe('cancel', () => {
    it('cancels a task with correct URL', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.cancel('task-xyz');

      expect(calls[0].url).toBe(
        'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/task-xyz/cancel',
      );

      const body = JSON.parse(calls[0].init.body as string);
      expect(body.params.id).toBe('task-xyz');
      expect(body.method).toBe('tasks/cancel');
    });

    it('signs cancel requests', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.cancel('task-xyz');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-molt-signature']).toBeDefined();
    });
  });

  // ── pollInbox ──────────────────────────────────────────

  describe('pollInbox', () => {
    it('polls inbox with GET and Ed25519 auth', async () => {
      const tasks: InboxTask[] = [
        {
          taskId: 'task-1',
          intent: 'text',
          status: 'submitted',
          callerNumber: 'CALL-AAAA-BBBB-CCCC',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'Hello' }] }],
          createdAt: '2025-01-01T00:00:00Z',
          updatedAt: '2025-01-01T00:00:00Z',
        },
      ];

      const { mockFetch, calls } = createMockFetch({
        body: { tasks },
      });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.pollInbox();

      expect(result.ok).toBe(true);
      expect(result.tasks).toHaveLength(1);
      expect(result.tasks[0].taskId).toBe('task-1');

      // Verify it was a GET
      expect(calls[0].init.method).toBe('GET');
      expect(calls[0].url).toBe('https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks');

      // Verify signed headers
      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-molt-signature']).toBeDefined();
    });

    it('returns empty array when no tasks', async () => {
      const { mockFetch } = createMockFetch({ body: { tasks: [] } });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.pollInbox();
      expect(result.tasks).toEqual([]);
    });

    it('handles missing tasks field gracefully', async () => {
      const { mockFetch } = createMockFetch({ body: {} });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.pollInbox();
      expect(result.tasks).toEqual([]);
    });
  });

  // ── heartbeat ──────────────────────────────────────────

  describe('heartbeat', () => {
    it('posts a presence heartbeat with signed request', async () => {
      const { mockFetch, calls } = createMockFetch({
        body: { lastSeenAt: '2025-01-01T00:00:00Z' },
      });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.heartbeat();

      expect(result.ok).toBe(true);
      expect(result.lastSeenAt).toBe('2025-01-01T00:00:00Z');
      expect(calls[0].url).toBe(
        'https://moltphone.ai/call/TEST-1234-5678-9ABC/presence/heartbeat',
      );
      expect(calls[0].init.method).toBe('POST');

      const headers = calls[0].init.headers as Record<string, string>;
      expect(headers['x-molt-signature']).toBeDefined();
    });
  });

  // ── startHeartbeat / stopHeartbeat ─────────────────────

  describe('auto-heartbeat', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('sends immediate heartbeat on start', async () => {
      const { mockFetch } = createMockFetch();
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, {
        fetch: mockFetch,
        heartbeatIntervalMs: 60_000,
        logger: () => {},
      });

      client.startHeartbeat();

      // Immediate heartbeat
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(client.isHeartbeatRunning).toBe(true);

      client.stopHeartbeat();
      expect(client.isHeartbeatRunning).toBe(false);
    });

    it('sends periodic heartbeats', async () => {
      const { mockFetch } = createMockFetch();
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, {
        fetch: mockFetch,
        heartbeatIntervalMs: 60_000,
        logger: () => {},
      });

      client.startHeartbeat();
      expect(mockFetch).toHaveBeenCalledTimes(1); // immediate

      jest.advanceTimersByTime(60_000);
      expect(mockFetch).toHaveBeenCalledTimes(2); // + 1 interval

      jest.advanceTimersByTime(60_000);
      expect(mockFetch).toHaveBeenCalledTimes(3); // + another

      client.stopHeartbeat();
    });

    it('does not start duplicate timers', () => {
      const { mockFetch } = createMockFetch();
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, {
        fetch: mockFetch,
        heartbeatIntervalMs: 60_000,
        logger: () => {},
      });

      client.startHeartbeat();
      client.startHeartbeat(); // second call should be no-op

      expect(mockFetch).toHaveBeenCalledTimes(1); // only one immediate

      client.stopHeartbeat();
    });

    it('stopHeartbeat is safe to call when not running', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { logger: () => {} });
      expect(() => client.stopHeartbeat()).not.toThrow();
    });
  });

  // ── verifyInbound ──────────────────────────────────────

  describe('verifyInbound', () => {
    it('verifies valid carrier-signed deliveries', () => {
      const carrierKp = generateKeyPair();
      const sim = createTestMoltSIM({ carrier_public_key: carrierKp.publicKey });
      const client = new MoltClient(sim);

      const body = JSON.stringify({ test: 'payload' });
      const delivery = signCarrierDelivery({
        carrierDomain: 'moltphone.ai',
        attestation: 'A',
        origNumber: 'CALL-AAAA-BBBB-CCCC',
        destNumber: 'TEST-1234-5678-9ABC',
        body,
        carrierPrivateKey: carrierKp.privateKey,
      });

      const headers = {
        'x-molt-identity': delivery.signature,
        'x-molt-identity-carrier': 'moltphone.ai',
        'x-molt-identity-attest': delivery.attestation,
        'x-molt-identity-timestamp': delivery.timestamp,
      };

      const result = client.verifyInbound(headers, body, 'CALL-AAAA-BBBB-CCCC');

      expect(result.trusted).toBe(true);
      expect(result.carrierVerified).toBe(true);
      expect(result.attestation).toBe('A');
    });

    it('rejects forged signatures in strict mode', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { strictMode: true });

      const result = client.verifyInbound(
        {
          'x-molt-identity': 'forged-signature',
          'x-molt-identity-carrier': 'moltphone.ai',
          'x-molt-identity-attest': 'A',
          'x-molt-identity-timestamp': Math.floor(Date.now() / 1000).toString(),
        },
        'some body',
      );

      expect(result.trusted).toBe(false);
    });

    it('rejects missing headers in strict mode', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { strictMode: true });

      const result = client.verifyInbound({}, 'some body');

      expect(result.trusted).toBe(false);
      expect(result.reason).toContain('Missing carrier identity headers');
    });

    it('accepts missing headers in non-strict mode', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { strictMode: false });

      const result = client.verifyInbound({}, 'some body');

      expect(result.trusted).toBe(true);
      expect(result.carrierVerified).toBe(false);
    });

    it('rejects carrier domain mismatch', () => {
      const carrierKp = generateKeyPair();
      const sim = createTestMoltSIM({ carrier_public_key: carrierKp.publicKey });
      const client = new MoltClient(sim);

      const body = 'test';
      const delivery = signCarrierDelivery({
        carrierDomain: 'evil-carrier.com',
        attestation: 'A',
        origNumber: 'CALL-AAAA-BBBB-CCCC',
        destNumber: 'TEST-1234-5678-9ABC',
        body,
        carrierPrivateKey: carrierKp.privateKey,
      });

      const result = client.verifyInbound({
        'x-molt-identity': delivery.signature,
        'x-molt-identity-carrier': 'evil-carrier.com',
        'x-molt-identity-attest': delivery.attestation,
        'x-molt-identity-timestamp': delivery.timestamp,
      }, body);

      expect(result.trusted).toBe(false);
      expect(result.reason).toContain('Carrier domain mismatch');
    });
  });

  // ── dispose ────────────────────────────────────────────

  describe('dispose', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stops heartbeat on dispose', () => {
      const { mockFetch } = createMockFetch();
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, {
        fetch: mockFetch,
        heartbeatIntervalMs: 60_000,
        logger: () => {},
      });

      client.startHeartbeat();
      expect(client.isHeartbeatRunning).toBe(true);

      client.dispose();
      expect(client.isHeartbeatRunning).toBe(false);
    });
  });

  // ── Error handling ─────────────────────────────────────

  describe('error responses', () => {
    it('returns non-ok result for 403 responses', async () => {
      const { mockFetch } = createMockFetch({
        status: 403,
        ok: false,
        body: { error: { code: 403, message: 'Policy denied' } },
      });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.sendTask('DEST-AAAA-BBBB-CCCC', 'Hi', 'text');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect(result.body.error).toBeTruthy();
    });

    it('returns non-ok result for 486 Busy', async () => {
      const { mockFetch } = createMockFetch({
        status: 486,
        ok: false,
        body: { error: { code: 486, message: 'Agent busy' } },
      });
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { fetch: mockFetch });

      const result = await client.call('DEST-AAAA-BBBB-CCCC', 'Are you there?');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(486);
    });
  });

  // ── URL construction ───────────────────────────────────

  describe('URL construction', () => {
    it('builds send URL for different targets', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.sendTask('ALPHA-AAAA-BBBB-CCCC', 'Test', 'text');
      expect(calls[0].url).toBe('https://moltphone.ai/call/ALPHA-AAAA-BBBB-CCCC/tasks/send');

      await client.sendTask('BETA-1111-2222-3333', 'Test', 'text');
      expect(calls[1].url).toBe('https://moltphone.ai/call/BETA-1111-2222-3333/tasks/send');
    });

    it('uses MoltSIM URL templates for reply/cancel', async () => {
      const sim = createTestMoltSIM({
        task_reply_url: 'https://custom-carrier.io/call/TEST-1234-5678-9ABC/tasks/:id/reply',
        task_cancel_url: 'https://custom-carrier.io/call/TEST-1234-5678-9ABC/tasks/:id/cancel',
      });
      const { mockFetch, calls } = createMockFetch();
      const client = new MoltClient(sim, { fetch: mockFetch });

      await client.reply('task-123', 'Reply');
      expect(calls[0].url).toBe('https://custom-carrier.io/call/TEST-1234-5678-9ABC/tasks/task-123/reply');

      await client.cancel('task-456');
      expect(calls[1].url).toBe('https://custom-carrier.io/call/TEST-1234-5678-9ABC/tasks/task-456/cancel');
    });
  });
});

// ── parseMoltSIM tests ───────────────────────────────────

describe('parseMoltSIM', () => {
  it('parses valid MoltSIM JSON', () => {
    const kp = generateKeyPair();
    const json = JSON.stringify({
      version: '1',
      carrier: 'moltphone.ai',
      agent_id: 'agent-1',
      molt_number: 'TEST-1234-5678-9ABC',
      carrier_call_base: 'https://moltphone.ai/call/TEST-1234-5678-9ABC',
      inbox_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks',
      task_reply_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/:id/reply',
      task_cancel_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/tasks/:id/cancel',
      presence_url: 'https://moltphone.ai/call/TEST-1234-5678-9ABC/presence/heartbeat',
      public_key: kp.publicKey,
      private_key: kp.privateKey,
      carrier_public_key: kp.publicKey,
      signature_algorithm: 'Ed25519',
      canonical_string: 'METHOD\\nPATH\\nCALLER\\nTARGET\\nTIMESTAMP\\nNONCE\\nBODY_SHA256_HEX',
      timestamp_window_seconds: 300,
    });

    const profile = parseMoltSIM(json);
    expect(profile.molt_number).toBe('TEST-1234-5678-9ABC');
    expect(profile.signature_algorithm).toBe('Ed25519');
  });

  it('throws on missing required fields', () => {
    expect(() => parseMoltSIM(JSON.stringify({ version: '1' }))).toThrow('missing required field');
  });

  it('throws on unsupported algorithm', () => {
    const kp = generateKeyPair();
    const json = JSON.stringify({
      version: '1',
      carrier: 'moltphone.ai',
      agent_id: 'agent-1',
      molt_number: 'TEST-1234-5678-9ABC',
      carrier_call_base: 'https://moltphone.ai/call/TEST-1234-5678-9ABC',
      public_key: kp.publicKey,
      private_key: kp.privateKey,
      carrier_public_key: kp.publicKey,
      signature_algorithm: 'RSA-2048',
    });

    expect(() => parseMoltSIM(json)).toThrow('Unsupported signature algorithm');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseMoltSIM('not json')).toThrow();
  });
});

// ── Discovery Tests ──────────────────────────────────────

describe('MoltClient Discovery', () => {
  describe('carrierApiBase', () => {
    it('derives origin from carrierCallBase', () => {
      const sim = createTestMoltSIM();
      const client = new MoltClient(sim, { logger: () => {} });
      expect(client.carrierApiBase).toBe('https://moltphone.ai');
    });

    it('handles localhost with port', () => {
      const sim = createTestMoltSIM({
        carrier_call_base: 'http://localhost:3000/call/TEST-1234-5678-9ABC',
      });
      const client = new MoltClient(sim, { logger: () => {} });
      expect(client.carrierApiBase).toBe('http://localhost:3000');
    });
  });

  describe('searchAgents', () => {
    it('calls GET /api/agents with query params', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch({
        body: { agents: [{ id: '1', moltNumber: 'TEST-AAAA-BBBB-CCCC', displayName: 'Alice' }], total: 1 } as any,
      });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.searchAgents('Alice', 'TEST', 10);

      expect(result.ok).toBe(true);
      expect(result.agents).toHaveLength(1);
      expect(result.agents[0].displayName).toBe('Alice');
      expect(result.total).toBe(1);
      expect(calls[0].url).toContain('/api/agents?');
      expect(calls[0].url).toContain('q=Alice');
      expect(calls[0].url).toContain('nation=TEST');
      expect(calls[0].url).toContain('limit=10');
    });

    it('omits missing params', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch({
        body: { agents: [], total: 0 } as any,
      });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      await client.searchAgents();

      expect(calls[0].url).toMatch(/\/api\/agents\??$/);
    });

    it('caps limit at 50', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch({
        body: { agents: [], total: 0 } as any,
      });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      await client.searchAgents('test', undefined, 100);

      expect(calls[0].url).toContain('limit=50');
    });

    it('handles array response (legacy format)', async () => {
      const sim = createTestMoltSIM();
      const agents = [
        { id: '1', moltNumber: 'TEST-AAAA', displayName: 'Alice' },
        { id: '2', moltNumber: 'TEST-BBBB', displayName: 'Bob' },
      ];
      const mockFetch = jest.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => agents,
        headers: new Headers(),
      })) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.searchAgents();

      expect(result.ok).toBe(true);
      expect(result.agents).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('returns error on non-ok response', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch } = createMockFetch({ status: 500, ok: false });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.searchAgents('test');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(500);
      expect(result.agents).toEqual([]);
    });

    it('returns error on network failure', async () => {
      const sim = createTestMoltSIM();
      const mockFetch = jest.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.searchAgents('test');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
    });
  });

  describe('fetchAgentCard', () => {
    it('calls GET /call/:moltNumber/agent.json', async () => {
      const sim = createTestMoltSIM();
      const card = {
        name: 'Test Agent',
        url: 'https://moltphone.ai/call/TEST-AAAA/tasks/send',
        skills: [{ id: 'call', name: 'Call' }],
      };
      const { mockFetch, calls } = createMockFetch({ body: card as any });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.fetchAgentCard('TEST-AAAA-BBBB-CCCC');

      expect(result.ok).toBe(true);
      expect(result.card?.name).toBe('Test Agent');
      expect(calls[0].url).toContain('/call/TEST-AAAA-BBBB-CCCC/agent.json');
    });

    it('returns null card on 404', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch } = createMockFetch({ status: 404, ok: false });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.fetchAgentCard('NONEXIST-1234');

      expect(result.ok).toBe(false);
      expect(result.card).toBeNull();
    });

    it('returns error on network failure', async () => {
      const sim = createTestMoltSIM();
      const mockFetch = jest.fn(async () => { throw new Error('timeout'); }) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.fetchAgentCard('TEST-AAAA');

      expect(result.ok).toBe(false);
      expect(result.status).toBe(0);
    });
  });

  describe('lookupNumber', () => {
    it('calls GET /api/registry/lookup/:moltNumber', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch, calls } = createMockFetch({
        body: { carrierDomain: 'moltphone.ai', callBaseUrl: 'https://moltphone.ai/call/TEST-AAAA' } as any,
      });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.lookupNumber('TEST-AAAA-BBBB-CCCC');

      expect(result.ok).toBe(true);
      expect(result.carrierDomain).toBe('moltphone.ai');
      expect(result.callBaseUrl).toBe('https://moltphone.ai/call/TEST-AAAA');
      expect(calls[0].url).toContain('/api/registry/lookup/TEST-AAAA-BBBB-CCCC');
    });

    it('returns error on 404', async () => {
      const sim = createTestMoltSIM();
      const { mockFetch } = createMockFetch({ status: 404, ok: false });
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch as any });

      const result = await client.lookupNumber('NONEXIST-1234');

      expect(result.ok).toBe(false);
    });
  });

  describe('resolveByName', () => {
    it('returns exact match over prefix match', async () => {
      const sim = createTestMoltSIM();
      const agents = [
        { id: '1', moltNumber: 'TEST-AAAA', displayName: 'Alice2', nationCode: 'TEST', skills: [] },
        { id: '2', moltNumber: 'TEST-BBBB', displayName: 'Alice', nationCode: 'TEST', skills: [] },
      ];
      const mockFetch = jest.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ agents, total: 2 }),
        headers: new Headers(),
      })) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.resolveByName('Alice');

      expect(result?.displayName).toBe('Alice');
      expect(result?.moltNumber).toBe('TEST-BBBB');
    });

    it('returns prefix match over arbitrary match', async () => {
      const sim = createTestMoltSIM();
      const agents = [
        { id: '1', moltNumber: 'TEST-AAAA', displayName: 'XAlice', nationCode: 'TEST', skills: [] },
        { id: '2', moltNumber: 'TEST-BBBB', displayName: 'AliceBot', nationCode: 'TEST', skills: [] },
      ];
      const mockFetch = jest.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ agents, total: 2 }),
        headers: new Headers(),
      })) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.resolveByName('Alice');

      expect(result?.displayName).toBe('AliceBot');
    });

    it('returns null when no agents found', async () => {
      const sim = createTestMoltSIM();
      const mockFetch = jest.fn(async () => ({
        status: 200,
        ok: true,
        json: async () => ({ agents: [], total: 0 }),
        headers: new Headers(),
      })) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.resolveByName('Nobody');

      expect(result).toBeNull();
    });

    it('returns null on network failure', async () => {
      const sim = createTestMoltSIM();
      const mockFetch = jest.fn(async () => { throw new Error('offline'); }) as any;
      const client = new MoltClient(sim, { logger: () => {}, fetch: mockFetch });

      const result = await client.resolveByName('Test');

      expect(result).toBeNull();
    });
  });

  describe('discovery cache', () => {
    it('caches search results and returns cached on next call', async () => {
      const sim = createTestMoltSIM();
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ agents: [{ id: '1', displayName: 'Alice' }], total: 1 }),
          headers: new Headers(),
        };
      }) as any;
      const client = new MoltClient(sim, {
        logger: () => {},
        fetch: mockFetch,
        discoveryCacheTtlMs: 60_000,
      });

      const r1 = await client.searchAgents('Alice');
      const r2 = await client.searchAgents('Alice');

      expect(r1.agents).toEqual(r2.agents);
      expect(callCount).toBe(1); // Only one actual fetch
    });

    it('does not cache when TTL is 0', async () => {
      const sim = createTestMoltSIM();
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ agents: [], total: 0 }),
          headers: new Headers(),
        };
      }) as any;
      const client = new MoltClient(sim, {
        logger: () => {},
        fetch: mockFetch,
        discoveryCacheTtlMs: 0,
      });

      await client.searchAgents('Alice');
      await client.searchAgents('Alice');

      expect(callCount).toBe(2); // Two fetches, no caching
    });

    it('clearDiscoveryCache forces fresh fetch', async () => {
      const sim = createTestMoltSIM();
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ agents: [], total: 0 }),
          headers: new Headers(),
        };
      }) as any;
      const client = new MoltClient(sim, {
        logger: () => {},
        fetch: mockFetch,
        discoveryCacheTtlMs: 60_000,
      });

      await client.searchAgents('Alice');
      expect(callCount).toBe(1);

      client.clearDiscoveryCache();

      await client.searchAgents('Alice');
      expect(callCount).toBe(2);
    });

    it('cache expires after TTL', async () => {
      jest.useFakeTimers();
      const sim = createTestMoltSIM();
      let callCount = 0;
      const mockFetch = jest.fn(async () => {
        callCount++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ agents: [], total: 0 }),
          headers: new Headers(),
        };
      }) as any;
      const client = new MoltClient(sim, {
        logger: () => {},
        fetch: mockFetch,
        discoveryCacheTtlMs: 5_000,
      });

      await client.searchAgents('Alice');
      expect(callCount).toBe(1);

      // Advance past TTL
      jest.advanceTimersByTime(6_000);

      await client.searchAgents('Alice');
      expect(callCount).toBe(2);

      jest.useRealTimers();
    });

    it('caches agent card and lookup results', async () => {
      const sim = createTestMoltSIM();
      let callCount = 0;
      const mockFetch = jest.fn(async (url: string) => {
        callCount++;
        if (url.includes('agent.json')) {
          return {
            status: 200,
            ok: true,
            json: async () => ({ name: 'Test', skills: [] }),
            headers: new Headers(),
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({ carrierDomain: 'moltphone.ai' }),
          headers: new Headers(),
        };
      }) as any;
      const client = new MoltClient(sim, {
        logger: () => {},
        fetch: mockFetch,
        discoveryCacheTtlMs: 60_000,
      });

      // Agent card — 2 calls, 1 fetch
      await client.fetchAgentCard('TEST-AAAA');
      await client.fetchAgentCard('TEST-AAAA');
      expect(callCount).toBe(1);

      // Lookup — 2 calls, 1 fetch
      await client.lookupNumber('TEST-BBBB');
      await client.lookupNumber('TEST-BBBB');
      expect(callCount).toBe(2); // 1 + 1 new
    });
  });
});