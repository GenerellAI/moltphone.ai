'use client';

import { useState, useCallback, useEffect } from 'react';
import { Phone, X } from 'lucide-react';
import { useSSEListener, type SSETaskData } from '@/components/SSEProvider';
import { useStatus } from '@/components/StatusProvider';

interface QueuedToast {
  id: string;
  callerName: string;
  callerNumber: string | null;
  intent: string;
  createdAt: number;
}

const TOAST_DURATION = 5000;

/**
 * DndToastStack — shows small, non-blocking toasts in the bottom-right
 * corner when in DND mode and a new inbound task arrives.
 * Each toast auto-dismisses after 5 seconds. Stacks up to 3.
 */
export function DndToastStack() {
  const { status } = useStatus();
  const [toasts, setToasts] = useState<QueuedToast[]>([]);

  const handleCreated = useCallback((data: SSETaskData) => {
    if (status !== 'dnd') return;
    if (data.task?.status !== 'submitted') return;

    const toast: QueuedToast = {
      id: data.taskId,
      callerName: data.task?.caller?.displayName ?? 'Unknown',
      callerNumber: data.task?.caller?.moltNumber ?? null,
      intent: data.task?.intent ?? 'call',
      createdAt: Date.now(),
    };

    setToasts(prev => [...prev.slice(-2), toast]); // keep max 3
  }, [status]);

  useSSEListener('task.created', handleCreated, [handleCreated]);

  // Auto-dismiss expired toasts
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setToasts(prev => prev.filter(t => now - t.createdAt < TOAST_DURATION));
    }, 500);
    return () => clearInterval(timer);
  }, [toasts.length]);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className="pointer-events-auto animate-in slide-in-from-right-4 duration-300 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg backdrop-blur-md border"
          style={{
            background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)',
            borderColor: 'color-mix(in srgb, #f59e0b 30%, transparent)',
            minWidth: '240px',
            maxWidth: '320px',
          }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, #f59e0b 15%, transparent)' }}
          >
            <Phone className="h-3.5 w-3.5 text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-medium truncate">{toast.callerName}</div>
            <div className="text-[10px] text-muted-foreground">
              {toast.intent === 'text' ? 'Message queued' : 'Call queued'}
              {toast.callerNumber && (
                <span className="ml-1 font-mono opacity-60">{toast.callerNumber}</span>
              )}
            </div>
          </div>
          <button
            onClick={() => dismiss(toast.id)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
