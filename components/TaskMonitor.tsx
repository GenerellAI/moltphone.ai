'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';

// ── Types ────────────────────────────────────────────────

interface AgentRef {
  id: string;
  phoneNumber: string;
  displayName: string;
}

interface TaskSummary {
  id: string;
  status: string;
  intent: string;
  createdAt: string;
  callee: AgentRef;
  caller: AgentRef | null;
}

interface TaskMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string; data?: unknown; mimeType?: string; uri?: string }>;
  createdAt: string;
}

interface TaskDetail extends TaskSummary {
  messages: TaskMessage[];
  sessionId?: string;
  forwardingHops?: string[];
}

// ── Constants ────────────────────────────────────────────

const statusBadge: Record<string, string> = {
  working: 'badge-success',
  submitted: 'badge-brand',
  input_required: 'badge-brand',
  completed: 'badge',
  canceled: 'badge-warning',
  failed: 'badge-danger',
};

const statusIcons: Record<string, string> = {
  working: '📞',
  submitted: '📬',
  input_required: '💬',
  completed: '✅',
  canceled: '📵',
  failed: '⚠️',
};

// ── Component ────────────────────────────────────────────

export default function TaskMonitor({ initialTasks }: { initialTasks: TaskSummary[] }) {
  const [tasks, setTasks] = useState<TaskSummary[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const taskEventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Connect to global SSE stream
  useEffect(() => {
    const es = new EventSource('/api/tasks/stream');
    eventSourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const handleEvent = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        const { taskId, type, task: taskInfo } = data;

        setTasks(prev => {
          const existing = prev.find(t => t.id === taskId);
          if (existing) {
            return prev.map(t =>
              t.id === taskId ? { ...t, status: taskInfo?.status ?? t.status } : t
            );
          }
          // New task — prepend
          if (taskInfo) {
            return [
              {
                id: taskId,
                status: taskInfo.status,
                intent: taskInfo.intent,
                createdAt: data.timestamp,
                callee: taskInfo.callee,
                caller: taskInfo.caller,
              },
              ...prev,
            ];
          }
          return prev;
        });

        // If we're viewing this task, update status in detail
        if (type === 'task.message') {
          setTaskDetail(prev => {
            if (!prev || prev.id !== taskId) return prev;
            return { ...prev, status: taskInfo?.status ?? prev.status } as TaskDetail;
          });
        }
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('task.created', handleEvent);
    es.addEventListener('task.status', handleEvent);
    es.addEventListener('task.message', handleEvent);
    es.addEventListener('task.canceled', handleEvent);

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  // Fetch full task detail when selected
  const selectTask = useCallback(async (taskId: string) => {
    setSelectedTaskId(taskId);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setTaskDetail(data);
      }
    } catch { /* ignore */ }
    setLoadingDetail(false);
  }, []);

  // Subscribe to single-task stream when viewing detail
  useEffect(() => {
    if (!selectedTaskId) return;
    const es = new EventSource(`/api/tasks/${selectedTaskId}/stream`);
    taskEventSourceRef.current = es;

    const handler = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        // Refresh detail on new events
        if (data.type === 'task.message') {
          fetch(`/api/tasks/${selectedTaskId}`)
            .then(r => r.json())
            .then(d => setTaskDetail(d))
            .catch(() => {});
        }
        if (data.type === 'task.status' || data.type === 'task.canceled') {
          setTaskDetail(prev => prev ? { ...prev, status: data.payload?.status ?? prev.status } : prev);
        }
      } catch { /* ignore */ }
    };

    es.addEventListener('task.message', handler);
    es.addEventListener('task.status', handler);
    es.addEventListener('task.canceled', handler);
    es.addEventListener('task.closed', handler);

    return () => {
      es.close();
      taskEventSourceRef.current = null;
    };
  }, [selectedTaskId]);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [taskDetail?.messages?.length]);

  return (
    <div className="flex gap-4" style={{ minHeight: 'calc(100vh - 12rem)' }}>
      {/* Left panel — task list */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-3">
          <h1 className="heading">Tasks</h1>
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ background: connected ? '#22c55e' : '#ef4444' }}
              title={connected ? 'Live' : 'Disconnected'}
            />
            <span className="text-xs text-muted">{connected ? 'Live' : 'Offline'}</span>
          </div>
        </div>

        {tasks.length === 0 ? (
          <div className="empty-state">
            <span className="text-5xl mb-3">🪼</span>
            <p>No tasks yet — your recents will appear here</p>
          </div>
        ) : (
          <div className="space-y-1 overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
            {tasks.map(task => {
              const isSelected = task.id === selectedTaskId;
              return (
                <button
                  key={task.id}
                  onClick={() => selectTask(task.id)}
                  className={`card w-full text-left p-3 transition-all duration-100 ${isSelected ? 'ring-2' : 'hover:opacity-80'}`}
                  style={isSelected ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent)' } : {}}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{statusIcons[task.status] || '📞'}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-sm truncate">
                          <span className="text-muted truncate">
                            {task.caller?.displayName ?? 'Anonymous'}
                          </span>
                          <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                          <span className="truncate">{task.callee.displayName}</span>
                        </div>
                        <div className="text-xs text-muted mt-0.5" style={{ opacity: 0.6 }}>
                          {new Date(task.createdAt).toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className={statusBadge[task.status] || 'badge'} style={{ fontSize: '0.65rem' }}>
                        {task.status}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Right panel — conversation detail */}
      <div className="hidden lg:flex flex-1 flex-col card overflow-hidden">
        {!selectedTaskId ? (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center">
              <span className="text-4xl block mb-2">💬</span>
              <p>Select a task to view the conversation</p>
            </div>
          </div>
        ) : loadingDetail ? (
          <div className="flex-1 flex items-center justify-center text-muted">
            <p>Loading...</p>
          </div>
        ) : taskDetail ? (
          <>
            {/* Header */}
            <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{statusIcons[taskDetail.status] || '📞'}</span>
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <Link href={`/agents/${taskDetail.caller?.id ?? ''}`} className="text-brand hover:underline">
                          {taskDetail.caller?.displayName ?? 'Anonymous'}
                        </Link>
                        <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                        <Link href={`/agents/${taskDetail.callee.id}`} className="text-brand hover:underline">
                          {taskDetail.callee.displayName}
                        </Link>
                      </div>
                      <div className="text-xs text-muted mt-0.5">
                        {taskDetail.intent} · {new Date(taskDetail.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <span className={statusBadge[taskDetail.status] || 'badge'}>
                  {taskDetail.status}
                </span>
              </div>
              {taskDetail.forwardingHops && taskDetail.forwardingHops.length > 0 && (
                <div className="text-xs text-muted mt-2">
                  🔀 Forwarded through {taskDetail.forwardingHops.length} hop(s)
                </div>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {taskDetail.messages.length === 0 ? (
                <div className="text-center text-muted text-sm py-8">No messages yet</div>
              ) : (
                taskDetail.messages.map(msg => (
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
                      <div className="text-xs text-muted mb-1 font-medium" style={{ opacity: 0.7 }}>
                        {msg.role === 'agent' ? '🤖 Agent' : '👤 Caller'}
                      </div>
                      {(msg.parts as Array<{ type: string; text?: string; data?: unknown }>).map((part, i) => (
                        <div key={i}>
                          {part.type === 'text' && (
                            <p className="text-sm whitespace-pre-wrap">{part.text}</p>
                          )}
                          {part.type === 'data' && (
                            <pre className="text-xs font-mono mt-1 p-2 rounded-lg overflow-x-auto"
                              style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
                              {JSON.stringify(part.data, null, 2)}
                            </pre>
                          )}
                          {part.type === 'file' && (
                            <div className="text-xs text-brand mt-1">📎 File attachment</div>
                          )}
                        </div>
                      ))}
                      <div className="text-xs text-muted mt-1" style={{ opacity: 0.5 }}>
                        {new Date(msg.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
