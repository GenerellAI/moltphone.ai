'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { useSession } from 'next-auth/react';

interface CreditsContextValue {
  balance: number;
  loading: boolean;
  /** Whether the credits system is enabled (carrier.config CREDITS_ENABLED) */
  enabled: boolean;
  /** Force-refresh the balance from the API */
  refresh: () => Promise<void>;
}

const CreditsContext = createContext<CreditsContextValue>({
  balance: 0,
  loading: true,
  enabled: false,
  refresh: async () => {},
});

export function useCredits() {
  return useContext(CreditsContext);
}

export function CreditsProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);

  const refresh = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const res = await fetch('/api/credits');
      if (res.ok) {
        const data = await res.json();
        setBalance(data.balance);
        setEnabled(data.enabled ?? false);
      }
    } catch {
      // Silently fail — badge will show stale balance
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  // Fetch on mount + when session changes
  useEffect(() => {
    if (session?.user?.id) {
      refresh();
    } else {
      setBalance(0);
      setLoading(false);
    }
  }, [session?.user?.id, refresh]);

  // Poll every 60s while tab is visible
  useEffect(() => {
    if (!session?.user?.id) return;

    const interval = setInterval(() => {
      if (!document.hidden) refresh();
    }, 60_000);

    return () => clearInterval(interval);
  }, [session?.user?.id, refresh]);

  return (
    <CreditsContext.Provider value={{ balance, loading, enabled, refresh }}>
      {children}
    </CreditsContext.Provider>
  );
}
