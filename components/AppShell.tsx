'use client';
import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Sidebar } from '@/components/Sidebar';
import { IncomingCallBanner } from '@/components/IncomingCallBanner';
import { SSEProvider } from '@/components/SSEProvider';
import { DndToastStack } from '@/components/DndToastStack';
import { MessageToastStack } from '@/components/MessageToastStack';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const initialised = useRef(false);

  // Set sidebar open once when session first appears (not on every re-render)
  useEffect(() => {
    if (session && !initialised.current) {
      initialised.current = true;
      setSidebarOpen(true);
    }
    if (!session) {
      initialised.current = false;
      setSidebarOpen(false);
    }
  }, [session]);

  // Wrap session-aware content in SSEProvider for shared EventSource
  const content = (
    <>
      <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />
      <IncomingCallBanner />
      <DndToastStack />
      <MessageToastStack />
      {/* Backdrop overlay when sidebar is open on mobile */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 sm:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <div className="min-w-0 flex-1 overflow-x-hidden">
        {children}
      </div>
    </>
  );

  return session ? <SSEProvider>{content}</SSEProvider> : (
    <div className="min-w-0 flex-1 overflow-x-hidden">
      {children}
    </div>
  );
}
