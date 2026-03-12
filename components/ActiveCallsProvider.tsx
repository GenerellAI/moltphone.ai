'use client';

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { ChatModelAdapter } from '@assistant-ui/react';

export interface CallMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ActiveCall {
  agentId: string;
  agentName: string;
  moltNumber: string;
  description?: string | null;
  adapter: ChatModelAdapter;
  taskId: string | null;
  startedAt: number;
  messages: CallMessage[];
}

interface ActiveCallsContextValue {
  activeCalls: Record<string, ActiveCall>;
  registerCall: (call: Omit<ActiveCall, 'startedAt' | 'taskId' | 'messages'>) => void;
  unregisterCall: (agentId: string) => void;
  updateTaskId: (agentId: string, taskId: string) => void;
  appendMessages: (agentId: string, msgs: CallMessage[]) => void;
}

const ActiveCallsContext = createContext<ActiveCallsContextValue>({
  activeCalls: {},
  registerCall: () => {},
  unregisterCall: () => {},
  updateTaskId: () => {},
  appendMessages: () => {},
});

export const useActiveCalls = () => useContext(ActiveCallsContext);

export function ActiveCallsProvider({ children }: { children: ReactNode }) {
  const [calls, setCalls] = useState<Record<string, ActiveCall>>({});

  const registerCall = useCallback((call: Omit<ActiveCall, 'startedAt' | 'taskId' | 'messages'>) => {
    setCalls(prev => ({
      ...prev,
      [call.agentId]: { ...call, taskId: null, startedAt: Date.now(), messages: [] } as ActiveCall,
    }));
  }, []);

  const unregisterCall = useCallback((agentId: string) => {
    setCalls(prev => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [agentId]: _, ...rest } = prev;
      return rest;
    });
  }, []);

  const updateTaskId = useCallback((agentId: string, taskId: string) => {
    setCalls(prev => {
      const call = prev[agentId];
      if (!call) return prev;
      return { ...prev, [agentId]: { ...call, taskId } };
    });
  }, []);

  const appendMessages = useCallback((agentId: string, msgs: CallMessage[]) => {
    setCalls(prev => {
      const call = prev[agentId];
      if (!call) return prev;
      return { ...prev, [agentId]: { ...call, messages: [...call.messages, ...msgs] } };
    });
  }, []);

  return (
    <ActiveCallsContext.Provider value={{ activeCalls: calls, registerCall, unregisterCall, updateTaskId, appendMessages }}>
      {children}
    </ActiveCallsContext.Provider>
  );
}
