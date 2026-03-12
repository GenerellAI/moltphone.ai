'use client';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { LogOut, Users, Globe, UserRoundPlus, Phone, MessageSquare, Ban, Settings, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useSSEListener, type SSETaskData } from '@/components/SSEProvider';

function makeNavLinks(hasNations: boolean) {
  return [
    { href: '/calls', label: 'Calls', icon: Phone, badgeKey: 'calls' as const },
    { href: '/messages', label: 'Messages', icon: MessageSquare, badgeKey: 'messages' as const },
    { href: '/contacts', label: 'Contacts', icon: UserRoundPlus },
    { href: '/agents', label: hasNations ? 'Agents & Nations' : 'My Agents', icon: Users },
    { href: '/discover-agents', label: 'Discover Agents', icon: Globe },
    { href: '/blocked', label: 'Blocked', icon: Ban },
    { href: '/settings', label: 'Settings', icon: Settings },
  ];
}

interface SidebarProps {
  open: boolean;
  onToggle: () => void;
}

export function Sidebar({ open, onToggle }: SidebarProps) {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [unread, setUnread] = useState<{ calls: number; messages: number }>({ calls: 0, messages: 0 });
  const [hasNations, setHasNations] = useState(false);

  // Fetch whether user has any nations (owner or admin)
  useEffect(() => {
    if (!session) return;
    fetch('/api/nations/mine')
      .then(r => r.ok ? r.json() : [])
      .then(data => setHasNations(Array.isArray(data) && data.length > 0))
      .catch(() => {});
  }, [session]);

  const navLinks = makeNavLinks(hasNations);

  // Fetch unread counts on mount and when pathname changes
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications/unread');
      if (res.ok) setUnread(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    fetchUnread();
  }, [session, fetchUnread]);

  // Mark as seen when navigating to Calls or Messages
  useEffect(() => {
    if (!session) return;
    if (pathname === '/calls' && unread.calls > 0) {
      fetch('/api/notifications/mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'call' }),
      }).then(() => setUnread(prev => ({ ...prev, calls: 0 }))).catch(() => {});
    } else if (pathname === '/messages' && unread.messages > 0) {
      fetch('/api/notifications/mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'text' }),
      }).then(() => setUnread(prev => ({ ...prev, messages: 0 }))).catch(() => {});
    }
  }, [pathname, session, unread.calls, unread.messages]);

  // Listen to shared SSE for real-time badge updates
  const handleSSEEvent = useCallback((data: SSETaskData) => {
    const intent = data.task?.intent;
    if (!intent) return;
    // Only increment if user is NOT currently on that page
    if (intent === 'call' && pathname !== '/calls') {
      setUnread(prev => ({ ...prev, calls: prev.calls + 1 }));
    } else if (intent === 'text' && pathname !== '/messages') {
      setUnread(prev => ({ ...prev, messages: prev.messages + 1 }));
    }
  }, [pathname]);

  useSSEListener('task.created', handleSSEEvent, [handleSSEEvent]);

  if (!session) return null;

  const moltNumber = session?.user?.personalMoltNumber;
  const agentId = session?.user?.personalAgentId;

  return (
    <>
      {/* Collapsed toggle button — visible when sidebar is closed */}
      {!open && (
        <button
          onClick={onToggle}
          className="fixed top-[4.25rem] left-4 z-40 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          aria-label="Open sidebar"
        >
          <PanelLeft className="h-5 w-5" />
        </button>
      )}

      {/* Sidebar panel */}
      <aside
        className={`fixed top-14 left-0 z-40 h-[calc(100vh-3.5rem)] w-48 overflow-x-hidden bg-background/95 backdrop-blur-sm border-r border-border/50 flex flex-col transition-transform duration-200 ease-in-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <span className="text-sm font-semibold text-muted-foreground tracking-wide">Menu</span>
          <button
            onClick={onToggle}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label="Close sidebar"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>

        {moltNumber && (
          <div className="px-4 py-2">
            <p className="text-[10px] text-muted-foreground mb-0.5">Your MoltNumber</p>
            <Link href={`/agents/${agentId}`}>
              <p className="font-mono text-[10px] font-semibold text-primary hover:text-primary/80 transition-colors truncate">
                {moltNumber}
              </p>
            </Link>
          </div>
        )}

        <Separator className="my-2 opacity-50" />

        <nav className="flex flex-col gap-0.5 px-2 flex-1">
          {navLinks.map(({ href, label, icon: Icon, badgeKey }) => {
            const active = pathname === href;
            const count = badgeKey ? unread[badgeKey] : 0;
            return (
              <Button
                key={href}
                asChild
                variant={active ? 'secondary' : 'ghost'}
                size="sm"
                className={`w-full justify-start text-sm ${active ? 'text-primary' : 'text-muted-foreground'}`}
              >
                <Link href={href}>
                  <Icon className="h-4 w-4 mr-2" />
                  {label}
                  {count > 0 && (
                    <span className="ml-auto inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold leading-none bg-primary text-primary-foreground">
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </Link>
              </Button>
            );
          })}
        </nav>

        <Separator className="my-2 opacity-50" />
        <div className="px-2 pb-4">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-sm text-muted-foreground hover:text-destructive"
            onClick={() => signOut()}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>
    </>
  );
}
