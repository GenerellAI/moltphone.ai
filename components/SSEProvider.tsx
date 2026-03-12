'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from 'react';

// ── Types ────────────────────────────────────────────────

export interface SSETaskData {
  eventId: string;
  taskId: string;
  type: string;
  payload: unknown;
  task?: {
    id: string;
    status: string;
    intent: string;
    callee?: { id: string; moltNumber: string; displayName: string };
    caller?: { id: string; moltNumber: string; displayName: string } | null;
  };
  timestamp: string;
  sequenceNumber: number;
}

type SSEEventType = 'task.created' | 'task.status' | 'task.message' | 'task.canceled';
type SSEListener = (data: SSETaskData) => void;

interface SSEContextValue {
  /** Whether the EventSource connection is open */
  connected: boolean;
  /** Subscribe to a specific event type. Returns an unsubscribe function. */
  subscribe: (eventType: SSEEventType, listener: SSEListener) => () => void;
}

// ── Context ──────────────────────────────────────────────

const SSEContext = createContext<SSEContextValue>({
  connected: false,
  subscribe: () => () => {},
});

export function useSSE() {
  return useContext(SSEContext);
}

/**
 * Hook that subscribes to one or more SSE event types and calls
 * the listener for each matching event. Automatically unsubscribes
 * on unmount.
 */
export function useSSEListener(
  eventTypes: SSEEventType | SSEEventType[],
  listener: SSEListener,
  deps: unknown[] = [],
) {
  const { subscribe } = useSSE();

  useEffect(() => {
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    const unsubs = types.map(t => subscribe(t, listener));
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe, ...deps]);
}

// ── Provider ─────────────────────────────────────────────

/**
 * SSEProvider — manages a single shared EventSource connection to
 * /api/tasks/stream. All components use `useSSE()` or `useSSEListener()`
 * instead of creating their own EventSource.
 *
 * This eliminates the HTTP/1.1 connection limit problem where multiple
 * SSE connections from the same page exhaust the browser's 6-connection
 * limit per origin.
 */
export function SSEProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef(new Map<SSEEventType, Set<SSEListener>>());
  const esRef = useRef<EventSource | null>(null);

  const subscribe = useCallback((eventType: SSEEventType, listener: SSEListener) => {
    const map = listenersRef.current;
    if (!map.has(eventType)) {
      map.set(eventType, new Set());
    }
    map.get(eventType)!.add(listener);
    return () => {
      map.get(eventType)?.delete(listener);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/tasks/stream');
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const dispatch = (eventType: SSEEventType) => (e: MessageEvent) => {
      try {
        const data: SSETaskData = JSON.parse(e.data);
        const listeners = listenersRef.current.get(eventType);
        if (listeners) {
          for (const listener of listeners) {
            try { listener(data); } catch { /* consumer error */ }
          }
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('task.created', dispatch('task.created'));
    es.addEventListener('task.status', dispatch('task.status'));
    es.addEventListener('task.message', dispatch('task.message'));
    es.addEventListener('task.canceled', dispatch('task.canceled'));

    return () => {
      es.close();
      esRef.current = null;
      setConnected(false);
    };
  }, []);

  return (
    <SSEContext.Provider value={{ connected, subscribe }}>
      {children}
    </SSEContext.Provider>
  );
}
