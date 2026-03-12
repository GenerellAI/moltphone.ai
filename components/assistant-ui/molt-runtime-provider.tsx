'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CallMessage } from '@/components/ActiveCallsProvider';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

/** Context for agent info available to Thread sub-components */
export interface AgentContextValue {
  agentName: string;
  description?: string | null;
}
const AgentContext = createContext<AgentContextValue>({ agentName: '' });
export const useAgentContext = () => useContext(AgentContext);

/**
 * Extract text parts from an A2A response.
 * The call route returns: { id, status, message: { parts: [...] } }
 * Error responses return: { jsonrpc: "2.0", error: { code, message, data } }
 */
function extractText(response: Record<string, unknown>): string {
  // Success: { message: { parts: [{ type: "text", text }] } }
  const msg = response.message as { parts?: Array<{ type: string; text?: string }> } | undefined;
  if (msg?.parts) {
    const texts = msg.parts.filter(p => p.type === 'text' && p.text).map(p => p.text!);
    if (texts.length) return texts.join('\n');
  }

  // A2A error with away message
  const error = response.error as { message?: string; data?: Record<string, unknown> } | undefined;
  if (error) {
    const away = (error.data as Record<string, unknown> | undefined)?.away_message;
    if (away) return `📭 ${away}`;
    return `⚠️ ${error.message || 'Unknown error'}`;
  }

  return '(no response)';
}

/**
 * Create a ChatModelAdapter that proxies messages through the carrier's
 * chat API. The adapter maintains a sessionId in its closure so multi-turn
 * conversations persist across messages.
 *
 * Exported so InlineChat / ActiveCallsProvider can create adapters that
 * outlive MoltRuntimeProvider mount cycles.
 */
export function createMoltAdapter(
  agentId: string,
  callbacks?: {
    onTaskCreated?: (taskId: string) => void;
    onMessages?: (userText: string, assistantText: string) => void;
  },
): ChatModelAdapter {
  let sessionId: string | null = null;

  return {
    async run({ messages, abortSignal }) {
      // Only send the last user message (not the full history — that's the agent's job)
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const text = lastUserMsg?.content
        .filter(p => p.type === 'text')
        .map(p => (p as { type: 'text'; text: string }).text)
        .join('\n') || '';

      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          intent: 'call',
          sessionId,
        }),
        signal: abortSignal,
      });

      const data = await res.json();

      // Remember session ID for multi-turn
      if (data.sessionId) sessionId = data.sessionId;

      // Notify parent of the task ID so it can cancel on hangup
      if (data.taskId) callbacks?.onTaskCreated?.(data.taskId);

      if (!res.ok) {
        const errorMsg = data.error || 'Request failed';
        throw new Error(errorMsg);
      }

      const responseText = extractText(data.response || {});

      // Record the exchange for history persistence across navigation
      callbacks?.onMessages?.(text, responseText);

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    },
  };
}

/**
 * Wraps children with an assistant-ui runtime powered by a MoltPhone adapter.
 *
 * The `adapter` prop is required — create one via `createMoltAdapter()` and
 * store it in `ActiveCallsProvider` so it survives page navigations.
 *
 * Set `resumed` to show a "call resumed" greeting instead of the default one.
 */
export function MoltRuntimeProvider({
  adapter,
  agentName,
  description,
  previousMessages,
  children,
}: {
  adapter: ChatModelAdapter;
  agentName?: string;
  description?: string | null;
  /** Conversation history from a previous mount (navigation away & back). */
  previousMessages?: CallMessage[];
  children: ReactNode;
}) {
  const initialMessages = useMemo(() => {
    const greeting = description
      ? `You've reached ${agentName || 'this agent'}. ${description}`
      : `You've reached ${agentName || 'this agent'}. How can I help you?`;
    const base = [{ role: 'assistant' as const, content: greeting }];

    // Replay stored conversation history so the user sees their previous messages
    if (previousMessages && previousMessages.length > 0) {
      return [
        ...base,
        ...previousMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
    }
    return base;
  }, [agentName, description, previousMessages]);

  const runtime = useLocalRuntime(adapter, { initialMessages });

  return (
    <AgentContext.Provider value={{ agentName: agentName || '', description }}>
      <AssistantRuntimeProvider runtime={runtime}>
        {children}
      </AssistantRuntimeProvider>
    </AgentContext.Provider>
  );
}
