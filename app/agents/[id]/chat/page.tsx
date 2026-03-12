'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Thread } from '@/components/assistant-ui/thread';
import { MoltRuntimeProvider, createMoltAdapter } from '@/components/assistant-ui/molt-runtime-provider';
import type { ChatModelAdapter } from '@assistant-ui/react';

interface AgentInfo {
  id: string;
  moltNumber: string;
  displayName: string;
  nationCode: string;
  nation: { badge: string };
}

export default function ChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { status } = useSession();
  const router = useRouter();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [agentId, setAgentId] = useState<string>('');
  const adapterRef = useRef<ChatModelAdapter | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    params.then((p) => {
      setAgentId(p.id);
      fetch('/api/agents/' + p.id)
        .then((r) => r.json())
        .then((data) => setAgent(data))
        .catch(() => {});
    });
  }, [params]);

  if (status === 'loading' || !agent || !agentId) {
    return (
      <div className="flex h-[calc(100vh-8rem)] items-center justify-center text-muted-foreground">
        Loading&hellip;
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Link
          href={'/agents/' + agentId}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          &larr;
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-foreground truncate">
            {agent.nation.badge} {agent.displayName}
          </div>
          <div className="text-xs text-primary font-mono">
            {agent.moltNumber}
          </div>
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 min-h-0">
        {(() => {
          if (!adapterRef.current) adapterRef.current = createMoltAdapter(agentId);
          return (
            <MoltRuntimeProvider adapter={adapterRef.current}>
              <Thread />
            </MoltRuntimeProvider>
          );
        })()}
      </div>
    </div>
  );
}
