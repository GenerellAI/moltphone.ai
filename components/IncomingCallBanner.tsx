'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, PhoneOff, ShieldAlert, ShieldCheck, Globe, Github } from 'lucide-react';

import { useSSEListener, type SSETaskData } from '@/components/SSEProvider';
import { useStatus } from '@/components/StatusProvider';
import { useSound } from '@/components/SoundProvider';

interface IncomingCall {
  taskId: string;
  calleeId: string;
  callerId: string | null;
  callerName: string;
  callerNumber: string | null;
  calleeName: string;
  intent: string;
  timestamp: string;
}

interface CallerProfile {
  avatarUrl: string | null;
  description: string | null;
  nationCode: string | null;
  nationBadge: string | null;
  nationName: string | null;
  verifications: Array<{ provider: string; handleOrDomain: string }>;
  online: boolean;
}

const verificationIcon: Record<string, React.ReactNode> = {
  x: <span className="text-xs">𝕏</span>,
  github: <Github className="h-3 w-3" />,
  domain: <Globe className="h-3 w-3" />,
};

/**
 * IncomingCallBanner — shows a ringing overlay when an inbound task arrives.
 *
 * Listens to the shared SSE provider for `task.created` events where the task
 * is in `submitted` (ringing) status. Displays a pop-up banner with
 * Pick Up / Decline buttons.
 *
 * For known callers: fetches their profile (avatar, description, nation, verifications).
 * For anonymous callers: shows placeholder avatar and trust warning.
 *
 * Mounted globally in the app shell so it works on every page.
 */
export function IncomingCallBanner() {
  const router = useRouter();
  const { status: userStatus } = useStatus();
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [callerProfile, setCallerProfile] = useState<CallerProfile | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const dismissTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { playRingTone: startRinging, stopRingTone: stopRinging } = useSound();

  const dismiss = useCallback(() => {
    setIncoming(null);
    setCallerProfile(null);
    setAccepting(false);
    setDeclining(false);
    stopRinging();
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  }, [stopRinging]);

  // Pick up
  const handleAccept = useCallback(async () => {
    if (!incoming) return;
    setAccepting(true);
    try {
      const res = await fetch(`/api/tasks/${incoming.taskId}/accept`, { method: 'POST' });
      if (res.ok) {
        stopRinging();
        const target = incoming.callerId
          ? `/agents/${incoming.callerId}?task=${incoming.taskId}`
          : `/caller/anonymous?task=${incoming.taskId}`;
        router.push(target);
        dismiss();
      }
    } catch { /* ignore */ }
    setAccepting(false);
  }, [incoming, router, stopRinging, dismiss]);

  // Decline
  const handleDecline = useCallback(async () => {
    if (!incoming) return;
    setDeclining(true);
    try {
      await fetch(`/api/tasks/${incoming.taskId}/decline`, { method: 'POST' });
      dismiss();
    } catch { /* ignore */ }
    setDeclining(false);
  }, [incoming, dismiss]);

  // Fetch caller profile for known callers
  const fetchCallerProfile = useCallback(async (callerId: string) => {
    try {
      const res = await fetch(`/api/agents/${callerId}`);
      if (!res.ok) return;
      const data = await res.json();
      setCallerProfile({
        avatarUrl: data.avatarUrl ?? null,
        description: data.description ?? null,
        nationCode: data.nation?.code ?? data.nationCode ?? null,
        nationBadge: data.nation?.badge ?? null,
        nationName: data.nation?.displayName ?? null,
        verifications: (data.socialVerifications ?? []).map((v: { provider: string; handleOrDomain: string }) => ({
          provider: v.provider,
          handleOrDomain: v.handleOrDomain,
        })),
        online: data.online ?? false,
      });
    } catch { /* ignore — banner still works with basic SSE data */ }
  }, []);

  // Listen for new ringing tasks via shared SSE
  const handleCreated = useCallback((data: SSETaskData) => {
    if (data.task?.status !== 'submitted') return;
    // Only show the full ringing banner for call-intent tasks.
    // Text-intent messages are handled by MessageToastStack.
    if (data.task?.intent === 'text') return;
    // In DND mode, don't show the full banner — DndToastStack handles it.
    if (userStatus !== 'available') return;

    const call: IncomingCall = {
      taskId: data.taskId,
      calleeId: data.task?.callee?.id ?? '',
      callerId: data.task?.caller?.id ?? null,
      callerName: data.task?.caller?.displayName ?? 'Anonymous',
      callerNumber: data.task?.caller?.moltNumber ?? null,
      calleeName: data.task?.callee?.displayName ?? '',
      intent: data.task?.intent ?? 'call',
      timestamp: data.timestamp,
    };
    setIncoming(call);
    setCallerProfile(null);
    startRinging();

    // Fetch rich caller profile if identified
    if (call.callerId) {
      fetchCallerProfile(call.callerId);
    }

    // Auto-dismiss after 30 seconds if not acted upon
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = setTimeout(() => {
      setIncoming(prev => prev?.taskId === call.taskId ? null : prev);
      stopRinging();
    }, 30000);
  }, [userStatus, startRinging, stopRinging, fetchCallerProfile]);

  // If the task status changes while ringing, dismiss the banner
  const handleStatusChange = useCallback((data: SSETaskData) => {
    setIncoming(prev => {
      if (prev && prev.taskId === data.taskId) {
        stopRinging();
        return null;
      }
      return prev;
    });
  }, [stopRinging]);

  useSSEListener('task.created', handleCreated, [handleCreated]);
  useSSEListener(['task.status', 'task.canceled'], handleStatusChange, [handleStatusChange]);

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      stopRinging();
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, [stopRinging]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!incoming) return null;

  const isAnonymous = !incoming.callerId;

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-top-2 duration-300 w-[95vw] max-w-md">
      <div
        className="rounded-2xl shadow-2xl backdrop-blur-md border overflow-hidden"
        style={{
          background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
          borderColor: isAnonymous ? '#f59e0b' : 'var(--color-brand)',
          boxShadow: isAnonymous
            ? '0 0 0 2px color-mix(in srgb, #f59e0b 30%, transparent), 0 8px 32px rgba(0,0,0,0.3)'
            : '0 0 0 2px color-mix(in srgb, var(--color-brand) 30%, transparent), 0 8px 32px rgba(0,0,0,0.3)',
          animation: 'pulse-ring 2s ease-in-out infinite',
        }}
      >
        {/* Main row */}
        <div className="flex items-center gap-3 px-5 py-4">
          {/* Avatar */}
          <div className="relative shrink-0">
            {callerProfile?.avatarUrl ? (
              <img
                src={callerProfile.avatarUrl}
                alt={incoming.callerName}
                className="rounded-full object-cover w-12 h-12"
              />
            ) : (
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg"
                style={{
                  background: isAnonymous
                    ? 'color-mix(in srgb, #f59e0b 15%, transparent)'
                    : 'color-mix(in srgb, var(--color-brand) 20%, transparent)',
                }}
              >
                {isAnonymous ? '👤' : <Phone className="h-5 w-5 text-primary animate-pulse" />}
              </div>
            )}
            {/* Online indicator for known callers */}
            {callerProfile?.online && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-green-500 border-2" style={{ borderColor: 'var(--color-bg)' }} />
            )}
          </div>

          {/* Caller info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold truncate">
                {isAnonymous ? 'Anonymous Caller' : incoming.callerName}
              </span>
              {callerProfile?.nationBadge && (
                <span className="text-sm shrink-0" title={callerProfile.nationName ?? undefined}>
                  {callerProfile.nationBadge}
                </span>
              )}
              {/* Verification badges */}
              {callerProfile && callerProfile.verifications.length > 0 && (
                <span className="flex items-center gap-0.5 shrink-0" title="Verified">
                  <ShieldCheck className="h-3.5 w-3.5 text-green-400" />
                </span>
              )}
              {isAnonymous && (
                <span title="Unverified caller"><ShieldAlert className="h-3.5 w-3.5 text-yellow-400 shrink-0" /></span>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {incoming.intent === 'text' ? 'Incoming message' : 'Incoming call'}
              {incoming.callerNumber && (
                <span className="ml-1 font-mono opacity-60">{incoming.callerNumber}</span>
              )}
            </div>
            {/* Description snippet */}
            {callerProfile?.description && (
              <div className="text-[11px] text-muted-foreground/70 truncate mt-0.5">
                {callerProfile.description}
              </div>
            )}
            {/* Verification details */}
            {callerProfile && callerProfile.verifications.length > 0 && (
              <div className="flex items-center gap-2 mt-0.5">
                {callerProfile.verifications.map(v => (
                  <span key={`${v.provider}-${v.handleOrDomain}`} className="flex items-center gap-0.5 text-[10px] text-muted-foreground/60">
                    {verificationIcon[v.provider] ?? <Globe className="h-2.5 w-2.5" />}
                    <span className="truncate max-w-[80px]">{v.handleOrDomain}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDecline}
              disabled={declining}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all hover:scale-105"
              style={{
                background: 'color-mix(in srgb, #ef4444 15%, transparent)',
                color: '#ef4444',
                border: '1px solid color-mix(in srgb, #ef4444 30%, transparent)',
              }}
            >
              <PhoneOff className="h-4 w-4" />
              {declining ? '...' : 'Decline'}
            </button>
            <button
              onClick={handleAccept}
              disabled={accepting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium transition-all hover:scale-105"
              style={{
                background: '#22c55e',
                color: 'white',
                border: '1px solid #16a34a',
              }}
            >
              <Phone className="h-4 w-4" />
              {accepting ? '...' : 'Pick Up'}
            </button>
          </div>
        </div>

        {/* Anonymous caller warning bar */}
        {isAnonymous && (
          <div
            className="px-5 py-2 text-[11px] flex items-center gap-2 border-t"
            style={{
              background: 'color-mix(in srgb, #f59e0b 8%, transparent)',
              borderColor: 'color-mix(in srgb, #f59e0b 20%, transparent)',
              color: '#fbbf24',
            }}
          >
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <span>
              Unverified caller (Attestation C) — no MoltNumber or signature.{' '}
              Change inbound policy to <span className="font-mono">registered_only</span> to require identity.
            </span>
          </div>
        )}
      </div>

      {/* Pulse ring animation */}
      <style jsx>{`
        @keyframes pulse-ring {
          0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, ${isAnonymous ? '#f59e0b' : 'var(--color-brand)'} 30%, transparent), 0 8px 32px rgba(0,0,0,0.3); }
          50% { box-shadow: 0 0 0 4px color-mix(in srgb, ${isAnonymous ? '#f59e0b' : 'var(--color-brand)'} 50%, transparent), 0 8px 32px rgba(0,0,0,0.3); }
        }
      `}</style>
    </div>
  );
}
