'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, MessageCircle,
  Mail, SendHorizontal, Inbox, CheckCircle2, AlertTriangle,
  ArrowRightLeft, RotateCcw, Paperclip, Bot, User, Ban, Info,
  ChevronDown,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useSSE, useSSEListener, type SSETaskData } from '@/components/SSEProvider';

// ── Types ────────────────────────────────────────────────

interface OwnerAgent {
  id: string;
  displayName: string;
  moltNumber: string;
}

interface AgentRef {
  id: string;
  moltNumber: string;
  displayName: string;
}

interface TaskSummary {
  id: string;
  status: string;
  intent: string;
  createdAt: string;
  callee: AgentRef;
  caller: AgentRef | null;
  lastError?: string | null;
}

interface TaskMessage {
  id: string;
  role: string;
  parts: Array<{ type: string; text?: string; data?: unknown; mimeType?: string; uri?: string }>;
  deliveryStatus?: 'sent' | 'delivered' | 'seen';
  createdAt: string;
}

interface TaskDetail extends TaskSummary {
  messages: TaskMessage[];
  sessionId?: string;
  forwardingHops?: string[];
  lastError?: string | null;
  retryCount?: number;
  maxRetries?: number;
}

/** A thread groups multiple text tasks by contact */
interface Thread {
  contactId: string;
  contact: AgentRef;
  tasks: TaskSummary[];
  lastMessageAt: string;
  messageCount: number;
  latestPreview: string;
}

/** User-friendly labels for lastError codes */
const errorLabel: Record<string, string> = {
  retries_exhausted: 'Retries exhausted — webhook did not respond',
  no_endpoint: 'Agent has no webhook endpoint configured',
  ssrf_blocked: 'Webhook URL failed security validation',
  webhook_timeout: 'Webhook timed out',
  webhook_error: 'Webhook returned an error',
};

type StatusFilter = 'all' | 'active' | 'missed' | 'failed' | 'ended';

// ── Constants ────────────────────────────────────────────

const statusBadge: Record<string, string> = {
  working: 'badge-success',
  submitted: 'badge-brand',
  input_required: 'badge-brand',
  completed: 'badge',
  canceled: 'badge-warning',
  failed: 'badge-danger',
};

const iconClass = 'h-4 w-4';

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const cls = className || iconClass;
  switch (status) {
    case 'working':        return <Phone className={`${cls} text-green-500`} />;
    case 'submitted':      return <PhoneIncoming className={`${cls} text-blue-400`} />;
    case 'input_required': return <MessageCircle className={`${cls} text-blue-400`} />;
    case 'completed':      return <CheckCircle2 className={`${cls} text-emerald-500`} />;
    case 'canceled':       return <PhoneMissed className={`${cls} text-orange-400`} />;
    case 'failed':         return <AlertTriangle className={`${cls} text-red-500`} />;
    default:               return <Phone className={cls} />;
  }
}

/** Intent-aware icon — texts get message-style icons */
function getStatusIcon(status: string, intent?: string): ReactNode {
  const cls = iconClass;
  if (intent === 'text') {
    switch (status) {
      case 'working':   return <SendHorizontal className={`${cls} text-green-500`} />;
      case 'submitted': return <Inbox className={`${cls} text-blue-400`} />;
      case 'completed': return <Mail className={`${cls} text-emerald-500`} />;
      case 'canceled':  return <Ban className={`${cls} text-orange-400`} />;
      default:          return <StatusIcon status={status} />;
    }
  }
  return <StatusIcon status={status} />;
}

/** Map A2A protocol status → user-friendly label (intent-aware) */
function getStatusLabel(status: string, intent?: string): string {
  const isText = intent === 'text';
  switch (status) {
    case 'working':        return isText ? 'Sending' : 'In Progress';
    case 'submitted':      return isText ? 'Queued' : 'Ringing';
    case 'input_required': return 'Awaiting Reply';
    case 'completed':      return isText ? 'Delivered' : 'Ended';
    case 'canceled':       return isText ? 'Canceled' : 'Missed';
    case 'failed':         return 'Failed';
    default:               return status;
  }
}

/** Map A2A intent → user-friendly label */
const intentLabel: Record<string, string> = {
  call: 'Call',
  text: 'Text',
};

// ── Date grouping helper ─────────────────────────────────

interface DateGroup {
  label: string;
  tasks: TaskSummary[];
}

function groupByDate(tasks: TaskSummary[]): DateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  const groups: Map<string, TaskSummary[]> = new Map();
  const order: string[] = [];

  for (const task of tasks) {
    const d = new Date(task.createdAt);
    const taskDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    let label: string;
    if (taskDate.getTime() === today.getTime()) {
      label = 'Today';
    } else if (taskDate.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else {
      label = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    }

    if (!groups.has(label)) {
      groups.set(label, []);
      order.push(label);
    }
    groups.get(label)!.push(task);
  }

  return order.map(label => ({ label, tasks: groups.get(label)! }));
}

// ── Component ────────────────────────────────────────────

export default function TaskMonitor({ initialTasks, title = 'Recents', emptyMessage = 'No calls yet — your recents will appear here', showFilters = false, mode = 'tasks', ownerAgentIds = [], ownerAgents = [] }: { initialTasks: TaskSummary[]; title?: string; emptyMessage?: string; showFilters?: boolean; mode?: 'tasks' | 'threads'; ownerAgentIds?: string[]; ownerAgents?: OwnerAgent[] }) {
  const searchParams = useSearchParams();
  const [tasks, setTasks] = useState<TaskSummary[]>(initialTasks);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<(TaskMessage & { taskCreatedAt: string })[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [taskDetail, setTaskDetail] = useState<TaskDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  useSSE();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [agentFilter, setAgentFilter] = useState<string>('all'); // 'all' or agent ID
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  // Track whether the user has viewed the missed/failed badges (clears notification badges)
  const [missedSeen, setMissedSeen] = useState(false);
  const [failedSeen, setFailedSeen] = useState(false);
  const taskEventSourceRef = useRef<EventSource | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  // Filter tasks by agent (applies to both modes)
  const agentFilteredTasks = agentFilter === 'all'
    ? tasks
    : tasks.filter(t =>
        t.caller?.id === agentFilter || t.callee.id === agentFilter
      );

  // Filter tasks by status
  const filteredTasks = agentFilteredTasks.filter(t => {
    switch (statusFilter) {
      case 'active': return ['submitted', 'working', 'input_required'].includes(t.status);
      case 'missed': return t.status === 'canceled';
      case 'failed': return t.status === 'failed';
      case 'ended': return ['completed', 'canceled'].includes(t.status);
      default: return true;
    }
  });

  const failedCount = agentFilteredTasks.filter(t => t.status === 'failed').length;
  const missedCount = agentFilteredTasks.filter(t => t.status === 'canceled').length;

  // Retry a failed task
  const retryTask = async (taskId: string) => {
    setRetrying(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}/retry`, { method: 'POST' });
      if (res.ok) {
        // Update local state optimistically
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'submitted', lastError: null } : t));
        setTaskDetail(prev => prev && prev.id === taskId ? { ...prev, status: 'submitted', lastError: null } : prev);
      }
    } catch { /* ignore */ }
    setRetrying(false);
  };

  // Send a reply to the active task
  const sendReply = useCallback(async (final = false) => {
    if (!selectedTaskId || !replyText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/tasks/${selectedTaskId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: replyText.trim(), final }),
      });
      if (res.ok) {
        setReplyText('');
        // Refresh the task detail to show the new message
        const detailRes = await fetch(`/api/tasks/${selectedTaskId}`);
        if (detailRes.ok) setTaskDetail(await detailRes.json());
      }
    } catch { /* ignore */ }
    setSending(false);
    inputRef.current?.focus();
  }, [selectedTaskId, replyText, sending]);

  // ── Thread grouping (for messages mode) ────────────────
  const ownerIdSet = useMemo(() => new Set(ownerAgentIds), [ownerAgentIds]);

  /** Get the "other" agent for a task (the one that isn't us) */
  const getContact = useCallback((task: TaskSummary): AgentRef => {
    if (task.caller && ownerIdSet.has(task.caller.id)) return task.callee;
    if (ownerIdSet.has(task.callee.id) && task.caller) return task.caller;
    return task.callee; // fallback: show callee
  }, [ownerIdSet]);

  /** Group tasks into threads by contact */
  const threads: Thread[] = (() => {
    if (mode !== 'threads') return [];
    const map = new Map<string, Thread>();
    for (const task of agentFilteredTasks) {
      const contact = getContact(task);
      const existing = map.get(contact.id);
      if (existing) {
        existing.tasks.push(task);
        existing.messageCount += 1;
        if (task.createdAt > existing.lastMessageAt) {
          existing.lastMessageAt = task.createdAt;
        }
      } else {
        map.set(contact.id, {
          contactId: contact.id,
          contact,
          tasks: [task],
          lastMessageAt: task.createdAt,
          messageCount: 1,
          latestPreview: '',
        });
      }
    }
    // Sort threads by most recent message
    return Array.from(map.values()).sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
  })();

  /** Select a thread and fetch all task details */
  const selectThread = useCallback(async (contactId: string) => {
    setSelectedThreadId(contactId);
    setSelectedTaskId(null);
    setLoadingThread(true);
    try {
      // Find all task IDs for this thread
      const threadTasks = tasks
        .filter(t => {
          const c = t.caller && ownerIdSet.has(t.caller.id) ? t.callee : (t.caller || t.callee);
          return c.id === contactId;
        })
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

      // Fetch detail for each task in the thread (parallel)
      const details = await Promise.all(
        threadTasks.map(t =>
          fetch(`/api/tasks/${t.id}`).then(r => r.ok ? r.json() : null).catch(() => null)
        )
      );

      // Flatten messages with task timestamp markers
      const allMessages: (TaskMessage & { taskCreatedAt: string })[] = [];
      for (const detail of details) {
        if (!detail?.messages) continue;
        for (const msg of detail.messages) {
          allMessages.push({ ...msg, taskCreatedAt: detail.createdAt });
        }
      }
      setThreadMessages(allMessages);
    } catch { /* ignore */ }
    setLoadingThread(false);
  }, [tasks, ownerIdSet]);

  // Handle SSE events via shared provider
  const handleSSEEvent = useCallback((data: SSETaskData) => {
    const { taskId, type, task: taskInfo } = data;

    setTasks(prev => {
      const existing = prev.find(t => t.id === taskId);
      if (existing) {
        // If a task transitions to canceled/failed, reset seen flags
        if (taskInfo?.status === 'canceled' && existing.status !== 'canceled') setMissedSeen(false);
        if (taskInfo?.status === 'failed' && existing.status !== 'failed') setFailedSeen(false);
        return prev.map(t =>
          t.id === taskId ? { ...t, status: taskInfo?.status ?? t.status } : t
        );
      }
      // New task — prepend
      if (taskInfo && taskInfo.callee) {
        if (taskInfo.status === 'canceled') setMissedSeen(false);
        if (taskInfo.status === 'failed') setFailedSeen(false);
        return [
          {
            id: taskId,
            status: taskInfo.status,
            intent: taskInfo.intent,
            createdAt: data.timestamp,
            callee: taskInfo.callee,
            caller: taskInfo.caller ?? null,
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
  }, []);

  useSSEListener(['task.created', 'task.status', 'task.message', 'task.canceled'], handleSSEEvent, [handleSSEEvent]);

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

  // Auto-select task from ?task= URL param
  useEffect(() => {
    const taskParam = searchParams.get('task');
    if (taskParam && !selectedTaskId) {
      selectTask(taskParam);
    }
  }, [searchParams, selectTask, selectedTaskId]);

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
  }, [taskDetail?.messages?.length, threadMessages.length]);

  return (
    <div className="flex gap-4 overflow-hidden" style={{ height: 'calc(100dvh - 5rem)' }}>
      {/* Left panel — task list */}
      <div className="w-full lg:w-[400px] shrink-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h1 className="heading">{title}</h1>
            {showFilters && missedCount > 0 && !missedSeen && (
              <span className="badge-warning" style={{ fontSize: '0.65rem' }}>
                {missedCount} missed
              </span>
            )}
            {showFilters && failedCount > 0 && !failedSeen && (
              <span className="badge-danger" style={{ fontSize: '0.65rem' }}>
                {failedCount} failed
              </span>
            )}
          </div>
          {/* Agent filter dropdown */}
          {ownerAgents.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setAgentDropdownOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors hover:opacity-80"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: agentFilter === 'all' ? 'var(--color-muted)' : 'var(--color-fg)' }}
              >
                <Bot className="h-3 w-3" />
                <span className="max-w-[120px] truncate">
                  {agentFilter === 'all' ? 'All agents' : ownerAgents.find(a => a.id === agentFilter)?.displayName ?? 'Agent'}
                </span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {agentDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAgentDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-40 rounded-lg py-1 min-w-[180px] shadow-lg"
                       style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                    <button
                      onClick={() => { setAgentFilter('all'); setAgentDropdownOpen(false); }}
                      className={`w-full text-left text-xs px-3 py-2 transition-colors hover:opacity-80 ${agentFilter === 'all' ? 'font-medium' : 'text-muted'}`}
                      style={agentFilter === 'all' ? { background: 'color-mix(in srgb, var(--color-brand) 10%, transparent)' } : {}}
                    >
                      All agents
                    </button>
                    {ownerAgents.map(agent => (
                      <button
                        key={agent.id}
                        onClick={() => { setAgentFilter(agent.id); setAgentDropdownOpen(false); }}
                        className={`w-full text-left text-xs px-3 py-2 transition-colors hover:opacity-80 ${agentFilter === agent.id ? 'font-medium' : 'text-muted'}`}
                        style={agentFilter === agent.id ? { background: 'color-mix(in srgb, var(--color-brand) 10%, transparent)' } : {}}
                      >
                        <div className="truncate">{agent.displayName}</div>
                        <div className="text-[10px] opacity-50 truncate">{agent.moltNumber}</div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Status filter tabs (calls only) */}
        {showFilters && (
          <div className="flex gap-1 mb-3">
            {(['all', 'active', 'missed', 'failed', 'ended'] as StatusFilter[]).map(f => {
              const filterLabel: Record<StatusFilter, string> = {
                all: 'All',
                active: 'Active',
                missed: `Missed${missedCount > 0 ? ` (${missedCount})` : ''}`,
                failed: `Failed${failedCount > 0 ? ` (${failedCount})` : ''}`,
                ended: 'Ended',
              };
              return (
                <button
                  key={f}
                  onClick={() => {
                    setStatusFilter(f);
                    if (f === 'missed') setMissedSeen(true);
                    if (f === 'failed') setFailedSeen(true);
                  }}
                  className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                    statusFilter === f
                      ? 'bg-foreground text-background font-medium'
                      : 'text-muted hover:text-foreground'
                  }`}
                  style={statusFilter === f ? {} : { background: 'var(--color-surface)' }}
                >
                  {filterLabel[f]}
                </button>
              );
            })}
          </div>
        )}

        {mode === 'threads' ? (
          /* ── Thread list (messages mode) ── */
          threads.length === 0 ? (
            <div className="empty-state">
              <Mail className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p>{emptyMessage}</p>
            </div>
          ) : (
            <div className="space-y-1 overflow-y-auto flex-1 min-h-0">
              {threads.map(thread => {
                const isSelected = thread.contactId === selectedThreadId;
                return (
                  <button
                    key={thread.contactId}
                    onClick={() => selectThread(thread.contactId)}
                    className={`card w-full text-left p-3 transition-all duration-100 ${isSelected ? 'ring-2' : 'hover:opacity-80'}`}
                    style={isSelected ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent)' } : {}}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                          <Mail className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-sm truncate">
                            <span className="truncate text-muted">{thread.tasks[0]?.caller?.displayName ?? 'Anonymous'}</span>
                            <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                            <span className="truncate">{thread.tasks[0]?.callee.displayName}</span>
                          </div>
                          <div className="text-xs text-muted truncate mt-0.5" style={{ opacity: 0.6 }}>
                            {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <div className="text-[10px] text-muted" style={{ opacity: 0.5 }}>
                          {new Date(thread.lastMessageAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )
        ) : (
          /* ── Task list (calls mode) ── */
          filteredTasks.length === 0 ? (
          <div className="empty-state">
            <Phone className="h-10 w-10 text-muted-foreground/40 mb-3" />
            <p>{statusFilter !== 'all' ? `No ${statusFilter} conversations` : emptyMessage}</p>
          </div>
        ) : (
          <div className="space-y-0 overflow-y-auto flex-1 min-h-0">
            {groupByDate(filteredTasks).map(group => (
              <div key={group.label}>
                <div className="text-[10px] uppercase tracking-wider text-muted px-2 pt-3 pb-1 sticky top-0 z-10 font-medium"
                     style={{ background: 'var(--color-bg)', opacity: 0.7 }}>
                  {group.label}
                </div>
                <div className="space-y-1">
                  {group.tasks.map(task => {
                    const isSelected = task.id === selectedTaskId;
                    const isFailed = task.status === 'failed';
                    const isMissed = task.status === 'canceled';
                    const isOutbound = task.caller != null && ownerIdSet.has(task.caller.id);
                    const isInbound = !isOutbound && ownerIdSet.has(task.callee.id);
                    return (
                      <button
                        key={task.id}
                        onClick={() => selectTask(task.id)}
                        className={`card w-full text-left p-3 transition-all duration-100 ${isSelected ? 'ring-2' : 'hover:opacity-80'}`}
                        style={{
                          ...(isSelected ? { borderColor: 'var(--color-brand)', boxShadow: '0 0 0 2px color-mix(in srgb, var(--color-brand) 20%, transparent)' } : {}),
                          ...(isFailed && !isSelected ? { borderLeft: '3px solid var(--color-danger, #ef4444)' } : {}),
                          ...(isMissed && !isSelected ? { borderLeft: '3px solid #f59e0b' } : {}),
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex items-center justify-center">
                              {isOutbound
                                ? <PhoneOutgoing className={`${iconClass} text-emerald-500`} />
                                : isInbound
                                  ? <PhoneIncoming className={`${iconClass} text-blue-400`} />
                                  : getStatusIcon(task.status, task.intent)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 text-sm truncate">
                                {isOutbound ? (
                                  <>
                                    <span className="truncate">{task.callee.displayName}</span>
                                  </>
                                ) : (
                                  <>
                                    <span className={`truncate ${isMissed ? 'text-orange-400' : 'text-muted'}`}>
                                      {task.caller?.displayName ?? 'Anonymous'}
                                    </span>
                                    <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                                    <span className="truncate">{task.callee.displayName}</span>
                                  </>
                                )}
                              </div>
                              <div className="text-xs text-muted mt-0.5" style={{ opacity: 0.6 }}>
                                {new Date(task.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                {isInbound && <span className="ml-1">· Inbound</span>}
                                {isMissed && <span className="ml-1 text-orange-400">· Missed</span>}
                              </div>
                              {isFailed && task.lastError && (
                                <div className="text-xs mt-0.5" style={{ color: 'var(--color-danger, #ef4444)', opacity: 0.8 }}>
                                  {errorLabel[task.lastError] || task.lastError}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 ml-2">
                            <span className={statusBadge[task.status] || 'badge'} style={{ fontSize: '0.65rem' }}>
                              {getStatusLabel(task.status, task.intent)}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Right panel — conversation detail */}
      <div className="hidden lg:flex flex-1 flex-col card overflow-hidden">
        {mode === 'threads' ? (
          /* ── Thread detail view (messages mode) ── */
          !selectedThreadId ? (
            <div className="flex-1 flex items-center justify-center text-muted">
              <div className="text-center">
                <Mail className="h-10 w-10 text-muted-foreground/40 mb-2 mx-auto" />
                <p>Select a thread to view messages</p>
              </div>
            </div>
          ) : loadingThread ? (
            <div className="flex-1 flex items-center justify-center text-muted">
              <p>Loading...</p>
            </div>
          ) : (() => {
            const thread = threads.find(t => t.contactId === selectedThreadId);
            if (!thread) return null;
            return (
              <>
                {/* Thread header */}
                <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
                  <div className="flex items-center gap-3">
                    <Mail className="h-5 w-5 text-muted-foreground" />
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        <Link href={`/agents/${thread.tasks[0]?.caller?.id ?? ''}`} className="text-brand hover:underline">
                          {thread.tasks[0]?.caller?.displayName ?? 'Anonymous'}
                        </Link>
                        <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                        <Link href={`/agents/${thread.tasks[0]?.callee.id}`} className="text-brand hover:underline">
                          {thread.tasks[0]?.callee.displayName}
                        </Link>
                      </div>
                      <div className="text-xs text-muted mt-0.5" style={{ opacity: 0.6 }}>
                        {thread.contact.moltNumber} · {thread.messageCount} message{thread.messageCount !== 1 ? 's' : ''}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-muted" style={{ opacity: 0.6 }}>
                    <Info className="h-3 w-3 shrink-0" />
                    <span>Each message is an independent exchange — the receiving agent does not retain context from previous messages.</span>
                  </div>
                </div>

                {/* Thread messages with timestamp separators */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {threadMessages.length === 0 ? (
                    <div className="text-center text-muted text-sm py-8">No messages yet</div>
                  ) : (
                    threadMessages.map((msg, idx) => {
                      // Show a date separator between messages from different tasks
                      const prevMsg = idx > 0 ? threadMessages[idx - 1] : null;
                      const showSeparator = !prevMsg || prevMsg.taskCreatedAt !== msg.taskCreatedAt;

                      return (
                        <div key={msg.id}>
                          {showSeparator && (
                            <div className="flex items-center gap-3 my-4">
                              <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                              <span className="text-[10px] text-muted shrink-0" style={{ opacity: 0.5 }}>
                                {new Date(msg.taskCreatedAt).toLocaleString(undefined, {
                                  month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                                })}
                              </span>
                              <div className="flex-1 h-px" style={{ background: 'var(--color-border)' }} />
                            </div>
                          )}
                          <div className={`flex ${msg.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                            <div
                              className="max-w-[80%] rounded-2xl px-4 py-2.5"
                              style={{
                                background: msg.role === 'agent'
                                  ? 'var(--color-surface)'
                                  : 'color-mix(in srgb, var(--color-brand) 15%, transparent)',
                                border: '1px solid var(--color-border)',
                              }}
                            >
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
                                    <div className="flex items-center gap-1 text-xs text-brand mt-1"><Paperclip className="h-3 w-3" /> File attachment</div>
                                  )}
                                </div>
                              ))}
                              <div className="text-xs text-muted mt-1" style={{ opacity: 0.5 }}>
                                {new Date(msg.createdAt).toLocaleTimeString()}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </>
            );
          })()
        ) : (
          /* ── Task detail view (calls mode) ── */
          !selectedTaskId ? (
          <div className="flex-1 flex items-center justify-center text-muted">
            <div className="text-center">
                <Phone className="h-10 w-10 text-muted-foreground/40 mb-2 mx-auto" />
              <p>Select a call to view the conversation</p>
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
                    <span className="flex items-center"><StatusIcon status={taskDetail.status} className="h-5 w-5" /></span>
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
                        {intentLabel[taskDetail.intent] || taskDetail.intent} · {new Date(taskDetail.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
                <span className={statusBadge[taskDetail.status] || 'badge'}>
                  {getStatusLabel(taskDetail.status, taskDetail.intent)}
                </span>
              </div>
              {taskDetail.forwardingHops && taskDetail.forwardingHops.length > 0 && (
                <div className="text-xs text-muted mt-2">
                  <span className="inline-flex items-center gap-1"><ArrowRightLeft className="h-3 w-3" /> Forwarded through {taskDetail.forwardingHops.length} hop(s)</span>
                </div>
              )}
              {taskDetail.status === 'failed' && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: 'color-mix(in srgb, var(--color-danger, #ef4444) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-danger, #ef4444) 30%, transparent)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--color-danger, #ef4444)' }}><AlertTriangle className="h-4 w-4" /> Call Failed</div>
                      <div className="text-xs text-muted mt-0.5">
                        {errorLabel[taskDetail.lastError ?? ''] || taskDetail.lastError || 'Unknown error'}
                        {taskDetail.retryCount != null && taskDetail.maxRetries != null && (
                          <span> · {taskDetail.retryCount}/{taskDetail.maxRetries} retries attempted</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => retryTask(taskDetail.id)}
                      disabled={retrying}
                      className="badge-brand text-xs px-3 py-1 cursor-pointer hover:opacity-80 disabled:opacity-50"
                    >
                      {retrying ? 'Retrying…' : <span className="inline-flex items-center gap-1"><RotateCcw className="h-3 w-3" /> Retry</span>}
                    </button>
                  </div>
                </div>
              )}
              {taskDetail.status === 'canceled' && (
                <div className="mt-3 p-3 rounded-lg" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5 text-sm font-medium text-orange-400"><PhoneMissed className="h-4 w-4" /> Missed Call</div>
                      <div className="text-xs text-muted mt-0.5">
                        {taskDetail.caller?.displayName ?? 'Anonymous'} tried to reach {taskDetail.callee.displayName}
                      </div>
                    </div>
                    {taskDetail.caller && (
                      <Link
                        href={`/calls?number=${encodeURIComponent(taskDetail.caller.moltNumber)}`}
                        className="badge-brand text-xs px-3 py-1 cursor-pointer hover:opacity-80 no-underline"
                      >
                        <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> Call Back</span>
                      </Link>
                    )}
                  </div>
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
                      <div className="flex items-center gap-1 text-xs text-muted mb-1 font-medium" style={{ opacity: 0.7 }}>
                        {msg.role === 'agent' ? <><Bot className="h-3 w-3" /> Agent</> : <><User className="h-3 w-3" /> Caller</>}
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
                            <div className="flex items-center gap-1 text-xs text-brand mt-1"><Paperclip className="h-3 w-3" /> File attachment</div>
                          )}
                        </div>
                      ))}
                      <div className="flex items-center gap-1 text-xs text-muted mt-1" style={{ opacity: 0.5 }}>
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

            {/* Reply input — only shown for outbound calls (user is the caller) */}
            {(() => {
              const isActive = ['submitted', 'working', 'input_required'].includes(taskDetail.status);
              const isOutbound = taskDetail.caller != null && ownerIdSet.has(taskDetail.caller.id);
              const isInbound = !isOutbound && ownerIdSet.has(taskDetail.callee.id);

              if (!isActive) return null;

              if (isInbound) {
                return (
                  <div className="p-3 border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center gap-2 text-xs text-muted" style={{ opacity: 0.7 }}>
                      <Bot className="h-3.5 w-3.5 shrink-0" />
                      <span>Your agent is handling this conversation automatically</span>
                    </div>
                  </div>
                );
              }

              return (
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
                      placeholder="Type a message…"
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
                    <span className="text-xs text-muted" style={{ opacity: 0.5 }}>
                      Enter to send · Shift+Enter for new line
                    </span>
                    <button
                      onClick={() => sendReply(true)}
                      className="text-xs text-muted hover:text-foreground transition-colors"
                      disabled={sending}
                    >
                      End conversation
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        ) : null
        )}
      </div>
    </div>
  );
}
