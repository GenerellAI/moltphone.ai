'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, X } from 'lucide-react';
import { useSSEListener, type SSETaskData } from '@/components/SSEProvider';
import { useSound } from '@/components/SoundProvider';

/* ─────────────────────────────────────────────────────────────────────────────
 * MessageToastStack — bottom-right clickable toast notifications.
 *
 * Listens to `task.message` SSE events and displays a small toast for each
 * incoming message. Clicking the toast navigates to the relevant page
 * (/calls or /messages) with the task selected.
 * Toasts auto-dismiss after 6 seconds.
 * ───────────────────────────────────────────────────────────────────────────── */

interface Toast {
  id: string;
  taskId: string;
  agentId: string | null;
  agentName: string;
  moltNumber: string | null;
  preview: string;
  intent: string;
  createdAt: number;
}

const MAX_TOASTS = 5;
const TOAST_TTL = 6000;

export function MessageToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const router = useRouter();
  const { playMessageTick } = useSound();
  // Ignore SSE catch-up events that arrived before this component mounted.
  // The SSE stream replays events from the last 60 s on connect, which would
  // otherwise re-show stale toasts every time the page refreshes.
  const mountedAt = useRef(Date.now());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const handleMessage = useCallback((data: SSETaskData) => {
    // Skip catch-up events from before mount
    if (data.timestamp && new Date(data.timestamp).getTime() < mountedAt.current) return;
    // The task.message SSE payload is { role, parts? } (not { message: { ... } })
    const payload = data.payload as { role?: string; parts?: Array<{ type: string; text?: string }> } | undefined;
    if (!payload) return;

    // Extract text preview from parts (if present)
    const textPart = payload.parts?.find(p => p.type === 'text');
    const preview = textPart?.text?.slice(0, 120) || 'New message';

    const callerName = data.task?.caller?.displayName ?? 'Anonymous';
    const callerId = data.task?.caller?.id ?? null;
    const callerNumber = data.task?.caller?.moltNumber ?? null;

    const toast: Toast = {
      id: `${data.eventId}-${Date.now()}`,
      taskId: data.taskId,
      agentId: callerId,
      agentName: callerName,
      moltNumber: callerNumber,
      preview,
      intent: 'call',
      createdAt: Date.now(),
    };

    playMessageTick();

    setToasts(prev => {
      const next = [toast, ...prev].slice(0, MAX_TOASTS);
      return next;
    });

    // Auto-dismiss
    setTimeout(() => removeToast(toast.id), TOAST_TTL);
  }, [playMessageTick, removeToast]);

  // Handle task.created events for text-intent tasks (fire-and-forget messages)
  const handleCreated = useCallback((data: SSETaskData) => {
    // Skip catch-up events from before mount
    if (data.timestamp && new Date(data.timestamp).getTime() < mountedAt.current) return;
    if (data.task?.status !== 'submitted') return;
    if (data.task?.intent !== 'text') return;

    const callerName = data.task?.caller?.displayName ?? 'Anonymous';
    const callerId = data.task?.caller?.id ?? null;
    const callerNumber = data.task?.caller?.moltNumber ?? null;

    // Extract message text from payload if available
    const payload = data.payload as { message?: { parts?: Array<{ type: string; text?: string }> } } | undefined;
    const textPart = payload?.message?.parts?.find(p => p.type === 'text');
    const preview = textPart?.text?.slice(0, 120) || 'New message';

    const toast: Toast = {
      id: `${data.eventId}-${Date.now()}`,
      taskId: data.taskId,
      agentId: callerId,
      agentName: callerName,
      moltNumber: callerNumber,
      preview,
      intent: 'text',
      createdAt: Date.now(),
    };

    playMessageTick();

    setToasts(prev => [toast, ...prev].slice(0, MAX_TOASTS));
    setTimeout(() => removeToast(toast.id), TOAST_TTL);
  }, [playMessageTick, removeToast]);

  useSSEListener('task.message', handleMessage, [handleMessage]);
  useSSEListener('task.created', handleCreated, [handleCreated]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto animate-in slide-in-from-right-4 fade-in duration-300 rounded-xl border border-border bg-background/95 backdrop-blur-sm shadow-lg overflow-hidden cursor-pointer hover:bg-muted/50 transition-colors group"
          onClick={() => {
            const page = toast.intent === 'text' ? '/messages' : '/calls';
            router.push(`${page}?task=${toast.taskId}`);
            removeToast(toast.id);
          }}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            {/* Icon */}
            <div className="shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center"
              style={{ background: 'color-mix(in srgb, var(--color-brand) 15%, transparent)' }}
            >
              <MessageSquare className="h-4 w-4 text-primary" />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold truncate">{toast.agentName}</span>
                {toast.moltNumber && (
                  <span className="text-[10px] font-mono text-muted-foreground/60 truncate">
                    {toast.moltNumber}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                {toast.preview}
              </p>
            </div>

            {/* Close */}
            <button
              className="shrink-0 p-1 rounded-full text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
              onClick={e => { e.stopPropagation(); removeToast(toast.id); }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
