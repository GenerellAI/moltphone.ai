'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { InlineChat } from '@/components/InlineChat';
import { InboundCallPanel } from '@/components/InboundCallPanel';
import { useActiveCalls } from '@/components/ActiveCallsProvider';

interface OwnedAgent {
  id: string;
  displayName: string;
  moltNumber: string;
  avatarUrl: string | null;
}

interface AgentChatSectionProps {
  agentId: string;
  agentName: string;
  moltNumber: string;
  description?: string | null;
  avatarUrl?: string | null;
  nationBadge?: string | null;
  online: boolean;
  dndEnabled: boolean;
  ownedAgents?: OwnedAgent[];
}

export function AgentChatSection(props: AgentChatSectionProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeTaskId = searchParams.get('task');
  const { activeCalls } = useActiveCalls();
  const inCall = !!activeCalls[props.agentId];

  const closeInboundPanel = () => {
    // Remove ?task= from URL without full navigation
    const url = new URL(window.location.href);
    url.searchParams.delete('task');
    router.replace(url.pathname + url.search, { scroll: false });
  };

  // When connected, render a fixed full-viewport overlay so the MoltSIM
  // and other page content are hidden and the chat fills the screen.
  if (inCall) {
    return (
      <div className="fixed inset-0 z-40 bg-background pt-14 flex flex-col">
        <div className="flex-1 min-h-0 max-w-2xl w-full mx-auto px-4 sm:px-6 py-3">
          <InlineChat {...props} />
        </div>
      </div>
    );
  }

  return (
    <>
      {activeTaskId && (
        <InboundCallPanel
          taskId={activeTaskId}
          agentName={props.agentName}
          onClose={closeInboundPanel}
        />
      )}
      <InlineChat {...props} />
    </>
  );
}
