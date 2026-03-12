'use client';

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import { useSession } from 'next-auth/react';

export type UserStatus = 'available' | 'dnd' | 'off';

interface StatusContextValue {
  status: UserStatus;
  setStatus: (s: UserStatus) => void;
}

const StatusContext = createContext<StatusContextValue>({
  status: 'available',
  setStatus: () => {},
});

export function useStatus() {
  return useContext(StatusContext);
}

const STORAGE_KEY = 'molt-user-status';

/**
 * StatusProvider — manages user-level availability state.
 *
 * Two modes:
 * - **available** — normal operation, full incoming-call banner
 * - **dnd** — calls still arrive (queued), but only a subtle toast; no ringing banner
 *
 * Persisted in localStorage. When the status changes, the personal agent's
 * `dndEnabled` field is synced to the server so the call protocol layer
 * can apply the correct routing (away message, busy, etc.).
 */
export function StatusProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [status, setStatusRaw] = useState<UserStatus>('available');

  // Hydrate from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dnd' || stored === 'off') setStatusRaw(stored);
    } catch { /* SSR or localStorage unavailable */ }
  }, []);

  // Sync to server when status changes
  const syncToServer = useCallback(async (newStatus: UserStatus) => {
    const agentId = (session?.user as Record<string, unknown> | undefined)?.personalAgentId;
    if (!agentId) return;
    try {
      const patch =
        newStatus === 'off'       ? { callEnabled: false, dndEnabled: false } :
        newStatus === 'dnd'       ? { callEnabled: true,  dndEnabled: true } :
        /* available */              { callEnabled: true,  dndEnabled: false };
      await fetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
    } catch { /* best-effort */ }
  }, [session]);

  // Presence heartbeat — keep personal agent "online" while the browser tab is open
  useEffect(() => {
    const agentId = (session?.user as Record<string, unknown> | undefined)?.personalAgentId;
    if (!agentId) return;

    const sendHeartbeat = () => {
      fetch(`/api/agents/${agentId}/heartbeat`, { method: 'POST' }).catch(() => {});
    };

    // Send immediately, then every 2 minutes (well within the 5-min TTL)
    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [session]);

  const setStatus = useCallback((s: UserStatus) => {
    setStatusRaw(s);
    try { localStorage.setItem(STORAGE_KEY, s); } catch { /* ignore */ }
    syncToServer(s);
  }, [syncToServer]);

  return (
    <StatusContext.Provider value={{ status, setStatus }}>
      {children}
    </StatusContext.Provider>
  );
}
