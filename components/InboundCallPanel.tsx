'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, PhoneOff, X } from 'lucide-react';
import { useSSEListener, type SSETaskData } from '@/components/SSEProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface TaskMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string; data?: unknown; mimeType?: string; uri?: string }>;
  deliveryStatus?: 'sent' | 'delivered' | 'seen';
  createdAt: string;
}

interface TaskDetail {
  id: string;
  status: string;
  intent: string;
  createdAt: string;
  callee: { id: string; moltNumber: string; displayName: string };
  caller: { id: string; moltNumber: string; displayName: string } | null;
  messages: TaskMessage[];
  sessionId?: string;
  forwardingHops?: string[];
  lastError?: string | null;
}

interface InboundCallPanelProps {
  taskId: string;
  agentName: string;
  onClose: () => void;
}

const statusLabel: Record<string, string> = {
  submitted: 'Ringing',
  working: 'Connected',
  input_required: 'Waiting for input',
  completed: 'Ended',
  canceled: 'Canceled',
  failed: 'Failed',
};

export function InboundCallPanel({ taskId, agentName, onClose }: InboundCallPanelProps) {
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isActive = task && ['submitted', 'working', 'input_required'].includes(task.status);

  // Fetch task detail
  const fetchTask = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setTask(data);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  // Auto-scroll on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [task?.messages?.length]);

  // Focus input on mount
  useEffect(() => {
    if (task && isActive) {
      inputRef.current?.focus();
    }
  }, [task, isActive]);

  // SSE: refresh on relevant events
  useSSEListener(
    ['task.status', 'task.message', 'task.canceled'],
    (data: SSETaskData) => {
      if (data.taskId === taskId) {
        fetchTask();
      }
    },
    [taskId, fetchTask],
  );

  const sendReply = async (final = false) => {
    const text = replyText.trim();
    if (!text && !final) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text || '(ended)', final }),
      });
      if (res.ok) {
        setReplyText('');
        fetchTask();
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  };

  const endConversation = async () => {
    try {
      await fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' });
      fetchTask();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center text-muted-foreground">
            <p className="text-sm">Loading conversation…</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!task) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">Conversation not found</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={onClose}>
              Dismiss
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const ended = ['completed', 'canceled', 'failed'].includes(task.status);

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {!ended && (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
              </span>
            )}
            <CardTitle className="text-sm font-medium">
              {ended ? 'Call Ended' : `Incoming Call from ${task.caller?.displayName ?? 'Anonymous'}`}
            </CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {statusLabel[task.status] || task.status}
            </span>
            {!ended && (
              <Button
                variant="destructive"
                size="sm"
                className="rounded-full h-7 px-3 gap-1 text-xs"
                onClick={endConversation}
              >
                <PhoneOff className="h-3 w-3" />
                End
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        {task.caller?.moltNumber && (
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            {task.caller.moltNumber} → {task.callee.moltNumber}
          </p>
        )}
      </CardHeader>

      {/* Messages */}
      <CardContent className="p-0">
        <div className="overflow-y-auto p-4 space-y-3" style={{ maxHeight: '400px' }}>
          {task.messages.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              No messages yet
            </div>
          ) : (
            task.messages.map(msg => (
              <div
                key={msg.id}
                className={`flex ${msg.role === 'agent' ? 'justify-start' : 'justify-end'}`}
              >
                <div
                  className="max-w-[80%] rounded-2xl px-4 py-2.5"
                  style={{
                    background: msg.role === 'agent'
                      ? 'var(--color-surface)'
                      : 'color-mix(in srgb, var(--color-brand) 15%, transparent)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <div className="text-xs text-muted-foreground mb-1 font-medium" style={{ opacity: 0.7 }}>
                    {msg.role === 'agent' ? `🤖 ${agentName}` : `👤 ${task.caller?.displayName ?? 'Caller'}`}
                  </div>
                  {(msg.parts as Array<{ type: string; text?: string; data?: unknown }>).map((part, i) => (
                    <div key={i}>
                      {part.type === 'text' && (
                        <div className="text-sm prose prose-sm prose-invert max-w-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{part.text ?? ''}</ReactMarkdown>
                        </div>
                      )}
                      {part.type === 'data' && (
                        <pre className="text-xs font-mono mt-1 p-2 rounded-lg overflow-x-auto"
                          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                          {JSON.stringify(part.data, null, 2)}
                        </pre>
                      )}
                      {part.type === 'file' && (
                        <div className="text-xs text-primary mt-1">📎 File attachment</div>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1" style={{ opacity: 0.5 }}>
                    <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                    {msg.role === 'user' && msg.deliveryStatus && (
                      <span
                        className={msg.deliveryStatus === 'seen' ? 'text-blue-400' : ''}
                        title={msg.deliveryStatus === 'sent' ? 'Sent' : msg.deliveryStatus === 'delivered' ? 'Delivered' : 'Seen'}
                      >
                        {msg.deliveryStatus === 'sent' ? '✓' : '✓✓'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Reply input */}
        {isActive && (
          <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Type a reply…"
                rows={1}
                className="flex-1 resize-none rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2"
                style={{
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-fg)',
                  maxHeight: '120px',
                }}
                disabled={sending}
              />
              <button
                onClick={() => sendReply()}
                disabled={sending || !replyText.trim()}
                className="shrink-0 rounded-xl p-2.5 transition-all hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                style={{
                  background: replyText.trim() ? 'var(--color-brand)' : 'var(--color-surface)',
                  color: replyText.trim() ? 'white' : 'var(--color-muted)',
                  border: '1px solid var(--color-border)',
                }}
                title="Send (Enter)"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-xs text-muted-foreground" style={{ opacity: 0.5 }}>
                Enter to send · Shift+Enter for new line
              </span>
              <button
                onClick={() => sendReply(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                disabled={sending}
              >
                End conversation
              </button>
            </div>
          </div>
        )}

        {/* Ended state */}
        {ended && (
          <div className="p-3 border-t text-center" style={{ borderColor: 'var(--color-border)' }}>
            <p className="text-xs text-muted-foreground mb-2">
              {task.status === 'completed' ? 'Conversation ended' : task.status === 'canceled' ? 'Call was canceled' : 'Call failed'}
            </p>
            <Button variant="outline" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
