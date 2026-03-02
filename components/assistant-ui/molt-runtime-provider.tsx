'use client';

import type { ReactNode } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';

/**
 * Extract text parts from an A2A response.
 * The dial route returns: { id, status, message: { parts: [...] } }
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

function createMoltAdapter(agentId: string): ChatModelAdapter {
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

      if (!res.ok) {
        const errorMsg = data.error || 'Request failed';
        throw new Error(errorMsg);
      }

      const responseText = extractText(data.response || {});

      return {
        content: [{ type: 'text' as const, text: responseText }],
      };
    },
  };
}

export function MoltRuntimeProvider({
  agentId,
  children,
}: {
  agentId: string;
  children: ReactNode;
}) {
  const adapter = createMoltAdapter(agentId);
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
