'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Thread } from '@/components/assistant-ui/thread';
import { MoltRuntimeProvider, createMoltAdapter } from '@/components/assistant-ui/molt-runtime-provider';
import { useActiveCalls } from '@/components/ActiveCallsProvider';
import { useSound } from '@/components/SoundProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhoneCall, PhoneOff, Loader2, Users, ArrowLeft, CheckCircle2, X, Eye, MessageSquare } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import Link from 'next/link';

interface OwnedAgent {
  id: string;
  displayName: string;
  moltNumber: string;
  avatarUrl: string | null;
}

interface InlineChatProps {
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

type CallState = 'idle' | 'ringing' | 'connected' | 'delegating' | 'delegated' | 'messaging' | 'message-sent';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function InlineChat({ agentId, agentName, moltNumber, description, avatarUrl: _avatarUrl, nationBadge: _nationBadge, online, dndEnabled, ownedAgents = [] }: InlineChatProps) {
  const { data: session, status } = useSession();
  const callerNumber = (session?.user as { personalMoltNumber?: string } | undefined)?.personalMoltNumber;

  // Global active-calls context for persistence across navigation
  const { activeCalls, registerCall, unregisterCall, updateTaskId, appendMessages } = useActiveCalls();
  const existingCall = activeCalls[agentId];

  // Initialise callState from context — if there's an active call, resume it
  const [callState, setCallState] = useState<CallState>(() => existingCall ? 'connected' : 'idle');
  const [resumed, setResumed] = useState(() => !!existingCall);

  // Delegate call state
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [instructions, setInstructions] = useState('');
  const [includeHistory, setIncludeHistory] = useState(true);
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [delegateResult, setDelegateResult] = useState<{ callerName: string; callerNumber: string; taskId: string } | null>(null);
  const [delegateError, setDelegateError] = useState('');
  const [delegateFrom, setDelegateFrom] = useState<'idle' | 'connected'>('idle');
  const [delegateIntent, setDelegateIntent] = useState<'call' | 'text'>('call');

  // Message state (text intent — fire-and-forget)
  const [messageText, setMessageText] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [messageError, setMessageError] = useState('');
  const [messageReply, setMessageReply] = useState<string | null>(null);

  // ── Ringing tone (via global SoundProvider) ──
  const { playRingTone: startRingTone, stopRingTone, playMessageTick } = useSound();

  // Sync with external hangup (e.g. from NavBar ongoing-calls dropdown)
  useEffect(() => {
    if (!existingCall && (callState === 'connected' || callState === 'ringing')) {
      stopRingTone();
      setCallState('idle');
      setResumed(false);
    }
  }, [existingCall, stopRingTone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop ring tone when call connects or is cancelled
  useEffect(() => {
    if (callState === 'ringing') {
      const timer = setTimeout(() => setCallState('connected'), 3000);
      return () => clearTimeout(timer);
    }
    // Any state other than ringing → stop the tone
    stopRingTone();
  }, [callState, stopRingTone]);

  const placeCall = () => {
    if (callState === 'idle' && !existingCall) {
      // Start ring tone DIRECTLY in click handler (required by browser autoplay policy)
      startRingTone();

      const adapter = createMoltAdapter(agentId, {
        onTaskCreated: (taskId) => updateTaskId(agentId, taskId),
        onMessages: (userText, assistantText) => {
          playMessageTick();
          appendMessages(agentId, [
            { role: 'user', content: userText },
            { role: 'assistant', content: assistantText },
          ]);
        },
      });
      registerCall({ agentId, agentName, moltNumber, description, adapter });
      setResumed(false);
      setCallState('ringing');
    }
  };

  const hangUp = async () => {
    const taskId = existingCall?.taskId ?? null;
    unregisterCall(agentId);
    setCallState('idle');
    setResumed(false);

    // Cancel the server-side task (best-effort, fire-and-forget)
    if (taskId) {
      fetch(`/api/tasks/${taskId}/cancel`, { method: 'POST' }).catch(() => {});
    }
  };

  const sendMessage = () => {
    setMessageText('');
    setMessageError('');
    setMessageReply(null);
    setCallState('messaging');
  };

  const cancelMessage = () => {
    setCallState('idle');
  };

  const submitMessage = async () => {
    const text = messageText.trim();
    if (!text) { setMessageError('Enter a message'); return; }
    setMessageSending(true);
    setMessageError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, intent: 'text' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || `Failed (${res.status})`);
      }
      const data = await res.json();
      const replyText = data?.history
        ?.filter((m: { role: string }) => m.role === 'agent')
        ?.map((m: { parts: { text?: string }[] }) => m.parts?.map(p => p.text).filter(Boolean).join(''))
        ?.join('\n') || null;
      setMessageReply(replyText);
      setCallState('message-sent');
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setMessageSending(false);
    }
  };

  const openDelegate = (from: 'idle' | 'connected' = 'idle') => {
    setDelegateFrom(from);
    setCallState('delegating');
    setSelectedAgentId('');
    setInstructions('');
    setIncludeHistory(from === 'connected');
    setDelegateIntent('call');
    setDelegateError('');
    setDelegateResult(null);
  };

  const cancelDelegate = () => {
    setCallState(delegateFrom);
  };

  const submitDelegate = async () => {
    if (!selectedAgentId) {
      setDelegateError('Select an agent to forward to');
      return;
    }
    setDelegateLoading(true);
    setDelegateError('');

    const callerAgent = ownedAgents.find(a => a.id === selectedAgentId);

    // Fire the delegate request non-blocking — don't wait for the full
    // webhook round-trip (which can take 10-30s with tool-calling agents).
    // The user watches the call unfold in Recents via SSE instead.
    fetch(`/api/agents/${agentId}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callerAgentId: selectedAgentId,
        instructions: instructions.trim() || undefined,
        intent: delegateIntent,
        includeHistory: delegateFrom === 'connected' && includeHistory,
      }),
    }).catch(() => {
      // Errors will appear as failed tasks in Recents
    });

    // Show success immediately — the call will appear in Recents via SSE
    setDelegateResult({
      callerName: callerAgent?.displayName || 'Agent',
      callerNumber: callerAgent?.moltNumber || '',
      taskId: '', // task created server-side, visible in Recents via SSE
    });
    setCallState('delegated');
    setDelegateLoading(false);
  };

  if (status !== 'authenticated') {
    return (
      <Card>
        <CardContent className="py-5 text-center text-muted-foreground">
          <p className="text-sm">
            <Link href="/login" className="text-primary hover:underline">Sign in</Link> to call {agentName}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Idle view (includes inline delegate & message panels) ──
  const isIdleView = callState === 'idle' ||
    callState === 'messaging' || callState === 'message-sent' ||
    (callState === 'delegating' && delegateFrom === 'idle') ||
    (callState === 'delegated' && delegateFrom === 'idle');

  if (isIdleView) {
    const delegateOpen = callState === 'delegating';
    const delegateSuccess = callState === 'delegated' && !!delegateResult;

    return (
      <Card>
        <CardContent className="p-4">
          {/* Action buttons row */}
          <TooltipProvider delayDuration={300}>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex-1 flex flex-col items-center gap-1">
                    <Button
                      className="w-full rounded-full gap-2 bg-green-600 hover:bg-green-700 text-white h-11"
                      onClick={placeCall}
                      disabled={callState !== 'idle'}
                    >
                      <PhoneCall className="h-4 w-4" />
                      Call {agentName}
                    </Button>
                    {callState === 'idle' && (
                      <span className="text-[10px] text-muted-foreground">Live conversation</span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-center">
                  Start a live multi-turn conversation
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-center gap-1">
                    <Button
                      variant="outline"
                      className="rounded-full gap-2 h-11 px-5"
                      onClick={sendMessage}
                      disabled={callState !== 'idle'}
                    >
                      <MessageSquare className="h-4 w-4" />
                      Message
                    </Button>
                    {callState === 'idle' && (
                      <span className="text-[10px] text-muted-foreground">One-shot</span>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px] text-center">
                  Send a one-shot message (fire &amp; forget)
                </TooltipContent>
              </Tooltip>
              {ownedAgents.length > 0 && !delegateOpen && !delegateSuccess && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex flex-col items-center gap-1">
                      <Button
                        variant="outline"
                        className="rounded-full gap-2 text-muted-foreground h-11 px-5"
                        onClick={() => openDelegate('idle')}
                      >
                        <Users className="h-4 w-4" />
                        Delegate
                      </Button>
                      {callState === 'idle' && (
                        <span className="text-[10px] text-muted-foreground">Via your agent</span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[220px] text-center">
                    Send one of your agents to handle this
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </TooltipProvider>

          {/* Expandable delegate panel */}
          {ownedAgents.length > 0 && delegateOpen && (
            <div className="border rounded-xl p-4 space-y-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">Delegate Agent to Call {agentName}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={cancelDelegate}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose an agent…" />
                </SelectTrigger>
                <SelectContent>
                  {ownedAgents.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.displayName}</span>
                        <span className="text-xs text-muted-foreground font-mono">{a.moltNumber}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex gap-1 p-0.5 rounded-lg bg-muted/60">
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${delegateIntent === 'call' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDelegateIntent('call')}
                >
                  <PhoneCall className="h-3 w-3" /> Call
                </button>
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${delegateIntent === 'text' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDelegateIntent('text')}
                >
                  <MessageSquare className="h-3 w-3" /> Message
                </button>
              </div>

              <Textarea
                placeholder={delegateIntent === 'call' ? `What should your agent discuss with ${agentName}?` : `What message should your agent send to ${agentName}?`}
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={2}
                className="resize-none text-sm"
              />

              {delegateError && (
                <p className="text-xs text-destructive">{delegateError}</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={cancelDelegate}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gap-1.5 bg-green-600 hover:bg-green-700 text-white"
                  onClick={submitDelegate}
                  disabled={delegateLoading || !selectedAgentId}
                >
                  {delegateLoading ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Delegating…</>
                  ) : delegateIntent === 'call' ? (
                    <><PhoneCall className="h-3.5 w-3.5" /> Delegate Call</>
                  ) : (
                    <><MessageSquare className="h-3.5 w-3.5" /> Delegate Message</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Delegate success */}
          {ownedAgents.length > 0 && delegateSuccess && delegateResult && (
            <div className="border rounded-xl p-4 space-y-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                <span className="font-medium text-sm">{delegateIntent === 'call' ? 'Call' : 'Message'} Delegated</span>
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{delegateResult.callerName}</span>{' '}
                {delegateIntent === 'call' ? 'is now calling' : 'is messaging'}{' '}
                <span className="font-medium text-foreground">{agentName}</span>
              </p>
              <p className="text-xs font-mono text-muted-foreground">
                {delegateResult.callerNumber} → {moltNumber}
              </p>
              <div className="flex gap-2 w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full flex-1"
                  onClick={() => { setCallState('idle'); setDelegateResult(null); }}
                >
                  Done
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full flex-1 gap-1.5"
                  asChild
                >
                  <Link href="/calls">
                    <Eye className="h-3.5 w-3.5" />
                    Watch Live
                  </Link>
                </Button>
              </div>
            </div>
          )}

          {/* Message compose panel */}
          {callState === 'messaging' && (
            <div className="border rounded-xl p-4 space-y-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">Message {agentName}</span>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={cancelMessage}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>

              <Textarea
                placeholder={`Type your message to ${agentName}…`}
                value={messageText}
                onChange={e => setMessageText(e.target.value)}
                rows={3}
                className="resize-none text-sm"
                onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) submitMessage(); }}
              />

              {messageError && (
                <p className="text-xs text-destructive">{messageError}</p>
              )}

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={cancelMessage}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={submitMessage}
                  disabled={messageSending || !messageText.trim()}
                >
                  {messageSending ? (
                    <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…</>
                  ) : (
                    <><MessageSquare className="h-3.5 w-3.5" /> Send</>
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Message sent */}
          {callState === 'message-sent' && (
            <div className="border rounded-xl p-4 space-y-3 mt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                <span className="font-medium text-sm">Message Sent</span>
              </div>
              {messageReply && (
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground mb-1">{agentName} replied:</div>
                  <p className="text-sm whitespace-pre-wrap">{messageReply}</p>
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full w-full"
                onClick={() => { setCallState('idle'); setMessageReply(null); }}
              >
                Done
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ── Delegating (from connected): forward panel ──
  if (callState === 'delegating' && delegateFrom === 'connected') {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelDelegate}>
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <div>
                <h3 className="font-semibold text-sm">{delegateFrom === 'connected' ? `Forward Call to ${agentName}` : `Delegate Agent to Call ${agentName}`}</h3>
                <p className="text-xs text-muted-foreground">{delegateFrom === 'connected' ? 'Choose which of your agents should handle this call' : 'Choose which of your agents to send'}</p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Select Agent</label>
              <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an agent…" />
                </SelectTrigger>
                <SelectContent>
                  {ownedAgents.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{a.displayName}</span>
                        <span className="text-xs text-muted-foreground font-mono">{a.moltNumber}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Action</label>
              <div className="flex gap-1 p-0.5 rounded-lg bg-muted/60">
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${delegateIntent === 'call' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDelegateIntent('call')}
                >
                  <PhoneCall className="h-3 w-3" /> Call
                </button>
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${delegateIntent === 'text' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  onClick={() => setDelegateIntent('text')}
                >
                  <MessageSquare className="h-3 w-3" /> Message
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Instructions (optional)</label>
              <Textarea
                placeholder={delegateIntent === 'call' ? `What should your agent discuss with ${agentName}?` : `What message should your agent send to ${agentName}?`}
                value={instructions}
                onChange={e => setInstructions(e.target.value)}
                rows={3}
                className="resize-none text-sm"
              />
            </div>

            {delegateFrom === 'connected' && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeHistory}
                  onChange={e => setIncludeHistory(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-muted-foreground">Include conversation history</span>
              </label>
            )}

            {delegateError && (
              <p className="text-xs text-destructive">{delegateError}</p>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={cancelDelegate}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={submitDelegate}
                disabled={delegateLoading || !selectedAgentId}
              >
                {delegateLoading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> {delegateFrom === 'connected' ? 'Forwarding…' : 'Delegating…'}</>
                ) : delegateIntent === 'call' ? (
                  <><PhoneCall className="h-4 w-4" /> {delegateFrom === 'connected' ? 'Forward Call' : 'Delegate Call'}</>
                ) : (
                  <><MessageSquare className="h-4 w-4" /> {delegateFrom === 'connected' ? 'Forward Message' : 'Delegate Message'}</>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Delegated (from connected): forward success ──
  if (callState === 'delegated' && delegateFrom === 'connected' && delegateResult) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="h-12 w-12 rounded-full bg-green-600/20 flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <div>
              <p className="font-semibold">{delegateFrom === 'connected' ? (delegateIntent === 'call' ? 'Call Forwarded' : 'Message Forwarded') : (delegateIntent === 'call' ? 'Call Delegated' : 'Message Delegated')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{delegateResult.callerName}</span> {delegateIntent === 'call' ? 'is now calling' : 'is messaging'} <span className="font-medium text-foreground">{agentName}</span>
              </p>
              <p className="text-xs font-mono text-muted-foreground mt-2">
                {delegateResult.callerNumber} → {moltNumber}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-full px-5"
                onClick={() => setCallState('idle')}
              >
                Done
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-full px-5 gap-1.5"
                asChild
              >
                <Link href="/calls">
                  <Eye className="h-3.5 w-3.5" />
                  Watch Live
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Ringing: connecting animation ──
  if (callState === 'ringing') {
    return (
      <Card>
        <CardContent className="py-10">
          <div className="flex flex-col items-center gap-4">
            <div className="relative">
              <div className="h-12 w-12 rounded-full bg-green-600/20 flex items-center justify-center animate-pulse">
                <PhoneCall className="h-5 w-5 text-green-500" />
              </div>
            </div>
            <div className="text-center">
              <p className="font-semibold">Calling {agentName}…</p>
              <p className="text-xs text-muted-foreground font-mono mt-1">{moltNumber}</p>
            </div>
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <Button
              variant="destructive"
              size="sm"
              className="rounded-full px-6 gap-1.5 mt-2"
              onClick={hangUp}
            >
              <PhoneOff className="h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Connected: live call ──
  return (
    <Card className="overflow-hidden flex flex-col h-full">
      <CardHeader className="pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
          </span>
          <CardTitle className="text-sm font-medium">Connected to {agentName}</CardTitle>
          <div className="flex items-center gap-2 ml-auto">
            {ownedAgents.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="rounded-full h-7 px-3 gap-1 text-xs"
                onClick={() => openDelegate('connected')}
              >
                <Users className="h-3 w-3" />
                Forward to Agent
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              className="rounded-full h-7 px-3 gap-1 text-xs"
              onClick={hangUp}
            >
              <PhoneOff className="h-3 w-3" />
              Hang up
            </Button>
          </div>
        </div>
        {callerNumber && (
          <p className="text-[10px] font-mono text-muted-foreground/60 mt-1">
            {callerNumber} → {moltNumber}
          </p>
        )}
      </CardHeader>
      <CardContent className="p-0 flex-1 min-h-0">
        <div className="h-full">
          {existingCall && (
            <MoltRuntimeProvider
              adapter={existingCall.adapter}
              agentName={agentName}
              description={description}
              previousMessages={resumed ? existingCall.messages : undefined}
            >
              <Thread />
            </MoltRuntimeProvider>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
