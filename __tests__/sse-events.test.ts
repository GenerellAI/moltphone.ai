/**
 * Tests for lib/sse-events.ts — Cross-instance SSE event distribution.
 *
 * Tests the in-memory path (no Redis Pub/Sub — Upstash HTTP does not
 * support SUBSCRIBE. Events are distributed via in-memory EventEmitter
 * and persisted to the DB for cross-instance catch-up).
 */

import {
  publishTaskEvent,
  subscribeToAgents,
  disconnectSSEEvents,
  SSETaskEvent,
} from '@/lib/sse-events';

// Ensure no Redis in test environment (in-memory fallback)
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

function makeEvent(overrides: Partial<SSETaskEvent> = {}): SSETaskEvent {
  return {
    eventId: 'evt-1',
    taskId: 'task-1',
    type: 'task.created',
    payload: { reason: 'test' },
    task: {
      id: 'task-1',
      status: 'submitted',
      intent: 'call',
      callee: { id: 'agent-a', moltNumber: 'TEST-AAAA-BBBB-CCCC', displayName: 'Agent A' },
      caller: { id: 'agent-b', moltNumber: 'TEST-DDDD-EEEE-FFFF', displayName: 'Agent B' },
    },
    timestamp: new Date().toISOString(),
    sequenceNumber: 1,
    ...overrides,
  };
}

afterEach(async () => {
  await disconnectSSEEvents();
});

describe('sse-events (in-memory fallback)', () => {
  it('delivers events to subscribers on the same agent', async () => {
    const received: SSETaskEvent[] = [];
    const unsub = subscribeToAgents(['agent-a'], (evt) => received.push(evt));

    const event = makeEvent();
    await publishTaskEvent(['agent-a'], event);

    // EventEmitter is synchronous in Node, so events arrive immediately
    expect(received).toHaveLength(1);
    expect(received[0].taskId).toBe('task-1');
    expect(received[0].type).toBe('task.created');

    unsub();
  });

  it('delivers events to multiple agent subscribers', async () => {
    const calleeEvents: SSETaskEvent[] = [];
    const callerEvents: SSETaskEvent[] = [];

    const unsub1 = subscribeToAgents(['agent-a'], (evt) => calleeEvents.push(evt));
    const unsub2 = subscribeToAgents(['agent-b'], (evt) => callerEvents.push(evt));

    const event = makeEvent();
    await publishTaskEvent(['agent-a', 'agent-b'], event);

    expect(calleeEvents).toHaveLength(1);
    expect(callerEvents).toHaveLength(1);
    expect(calleeEvents[0].eventId).toBe(callerEvents[0].eventId);

    unsub1();
    unsub2();
  });

  it('does not deliver events after unsubscribe', async () => {
    const received: SSETaskEvent[] = [];
    const unsub = subscribeToAgents(['agent-a'], (evt) => received.push(evt));

    unsub();

    await publishTaskEvent(['agent-a'], makeEvent());
    expect(received).toHaveLength(0);
  });

  it('supports multiple subscribers on the same agent', async () => {
    const a: SSETaskEvent[] = [];
    const b: SSETaskEvent[] = [];

    const unsub1 = subscribeToAgents(['agent-a'], (evt) => a.push(evt));
    const unsub2 = subscribeToAgents(['agent-a'], (evt) => b.push(evt));

    await publishTaskEvent(['agent-a'], makeEvent());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);

    unsub1();
    // Second subscriber still receives
    await publishTaskEvent(['agent-a'], makeEvent({ eventId: 'evt-2' }));
    expect(a).toHaveLength(1); // no new events
    expect(b).toHaveLength(2);

    unsub2();
  });

  it('handles subscriber errors gracefully', async () => {
    const good: SSETaskEvent[] = [];
    const unsub1 = subscribeToAgents(['agent-a'], () => { throw new Error('boom'); });
    const unsub2 = subscribeToAgents(['agent-a'], (evt) => good.push(evt));

    // Should not throw despite first subscriber erroring
    await publishTaskEvent(['agent-a'], makeEvent());
    expect(good).toHaveLength(1);

    unsub1();
    unsub2();
  });

  it('filters events by agent ID', async () => {
    const received: SSETaskEvent[] = [];
    const unsub = subscribeToAgents(['agent-a'], (evt) => received.push(evt));

    // Publish to a different agent — should not be delivered
    await publishTaskEvent(['agent-x'], makeEvent());
    expect(received).toHaveLength(0);

    // Publish to the subscribed agent — should be delivered
    await publishTaskEvent(['agent-a'], makeEvent());
    expect(received).toHaveLength(1);

    unsub();
  });

  it('subscribes to multiple agents at once', async () => {
    const received: SSETaskEvent[] = [];
    const unsub = subscribeToAgents(['agent-a', 'agent-b'], (evt) => received.push(evt));

    await publishTaskEvent(['agent-a'], makeEvent({ eventId: 'evt-from-a' }));
    await publishTaskEvent(['agent-b'], makeEvent({ eventId: 'evt-from-b' }));
    await publishTaskEvent(['agent-c'], makeEvent({ eventId: 'evt-from-c' }));

    // Should receive from agent-a and agent-b but not agent-c
    expect(received).toHaveLength(2);
    expect(received[0].eventId).toBe('evt-from-a');
    expect(received[1].eventId).toBe('evt-from-b');

    unsub();
  });

  it('handles publish with no subscribers gracefully', async () => {
    // Should not throw
    await publishTaskEvent(['agent-nobody'], makeEvent());
  });

  it('disconnectSSEEvents cleans up all listeners', async () => {
    const received: SSETaskEvent[] = [];
    subscribeToAgents(['agent-a'], (evt) => received.push(evt));

    await disconnectSSEEvents();

    // After disconnect, events should not be delivered
    await publishTaskEvent(['agent-a'], makeEvent());
    expect(received).toHaveLength(0);
  });

  it('preserves event structure through publish/subscribe', async () => {
    const received: SSETaskEvent[] = [];
    const unsub = subscribeToAgents(['agent-a'], (evt) => received.push(evt));

    const event = makeEvent({
      eventId: 'custom-id',
      taskId: 'custom-task',
      type: 'task.message',
      payload: { role: 'agent', data: [1, 2, 3] },
      sequenceNumber: 42,
    });
    await publishTaskEvent(['agent-a'], event);

    expect(received[0]).toEqual(event);

    unsub();
  });

  it('delivers to both agents when published to callee + caller', async () => {
    const calleeEvents: SSETaskEvent[] = [];
    const callerEvents: SSETaskEvent[] = [];
    const bystander: SSETaskEvent[] = [];

    const u1 = subscribeToAgents(['agent-callee'], (e) => calleeEvents.push(e));
    const u2 = subscribeToAgents(['agent-caller'], (e) => callerEvents.push(e));
    const u3 = subscribeToAgents(['agent-other'], (e) => bystander.push(e));

    await publishTaskEvent(['agent-callee', 'agent-caller'], makeEvent());

    expect(calleeEvents).toHaveLength(1);
    expect(callerEvents).toHaveLength(1);
    expect(bystander).toHaveLength(0);

    u1(); u2(); u3();
  });
});
