'use client';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useState, useRef, useEffect } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Sun, Moon, LogIn, Coins, Shield, Phone, PhoneOff, Volume2, VolumeX } from 'lucide-react';
import { DialBar } from '@/components/DialBar';
import { useCredits } from '@/components/CreditsProvider';
import { StatusPill } from '@/components/StatusPill';
import { useActiveCalls } from '@/components/ActiveCallsProvider';
import { useSound } from '@/components/SoundProvider';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="h-8 w-8"
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Moon className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}

function CreditsBadge() {
  const { balance, loading, enabled } = useCredits();

  if (!enabled || loading) return null;

  const formatted = balance >= 10_000
    ? `${(balance / 1000).toFixed(balance % 1000 === 0 ? 0 : 1)}k`
    : balance.toLocaleString();

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/credits"
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Coins className="h-3.5 w-3.5 text-amber-500" />
            <span>{formatted}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{balance.toLocaleString()} MoltCredits (for premium features)</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ── Live call timer ── */
function CallTimer({ startedAt }: { startedAt: number }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return <span className="tabular-nums">{m}:{s.toString().padStart(2, '0')}</span>;
}

/* ── Ongoing calls indicator + dropdown ── */
function OngoingCallsDropdown() {
  const { activeCalls, unregisterCall } = useActiveCalls();
  const callList = Object.values(activeCalls);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [open]);

  if (callList.length === 0) return null;

  const handleHangUp = (agentId: string, taskId: string | null) => {
    unregisterCall(agentId);
    if (taskId) {
      fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center gap-1.5 rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-1 text-xs font-medium text-green-600 dark:text-green-400 transition-colors hover:bg-green-500/20"
      >
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
        </span>
        <Phone className="h-3.5 w-3.5" />
        <span>{callList.length}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-border bg-background shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Ongoing Calls
            </p>
          </div>
          <div className="max-h-60 overflow-y-auto">
            {callList.map(call => (
              <div
                key={call.agentId}
                className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors"
              >
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>

                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => { router.push(`/agents/${call.agentId}`); setOpen(false); }}
                >
                  <p className="text-sm font-medium truncate">{call.agentName}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">
                    {call.moltNumber} &middot; <CallTimer startedAt={call.startedAt} />
                  </p>
                </button>

                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className="shrink-0 p-1.5 rounded-full text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        onClick={() => handleHangUp(call.agentId, call.taskId)}
                      >
                        <PhoneOff className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">Hang up</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Sound on/off toggle ── */
function SoundToggle() {
  const { soundEnabled, setSoundEnabled } = useSound();
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSoundEnabled(!soundEnabled)}
            aria-label={soundEnabled ? 'Mute sounds' : 'Unmute sounds'}
            className="h-8 w-8"
          >
            {soundEnabled ? (
              <Volume2 className="h-4 w-4 text-muted-foreground" />
            ) : (
              <VolumeX className="h-4 w-4 text-muted-foreground" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{soundEnabled ? 'Sound on' : 'Sound off'}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function NavBar() {
  const { data: session } = useSession();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 overflow-x-hidden border-b border-border bg-background/85 backdrop-blur-md">
      {/* Logo — pinned to the upper-left corner, above the sidebar */}
      <Link href="/" className="absolute left-4 top-0 h-14 flex items-center gap-2 z-10">
        <span className="text-2xl" role="img" aria-label="jellyfish">🪼</span>
        <span className="font-bold text-lg tracking-tight text-primary hidden sm:inline">
          MoltPhone
        </span>
      </Link>

      <div className="max-w-6xl mx-auto min-w-0 px-4 sm:px-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center h-14">
        {/* Left: spacer */}
        <div className="flex min-w-0 items-center" />

        {/* Center: Dial Bar */}
        <div className="flex min-w-0 justify-center overflow-hidden">
          <DialBar />
        </div>

        {/* Right: Actions */}
        <div className="flex min-w-0 items-center justify-end gap-1.5">
          {session && <OngoingCallsDropdown />}
          {session && <StatusPill />}
          {session && <SoundToggle />}
          {session && <CreditsBadge />}
          {session?.user?.role === 'admin' && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link href="/admin">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p>Admin Dashboard</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          <ThemeToggle />

          {!session && (
            <Link href="/login">
              <Button size="sm">
                <LogIn className="h-4 w-4 mr-1" />
                Login
              </Button>
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
