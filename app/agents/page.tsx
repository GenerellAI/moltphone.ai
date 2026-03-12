'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, BellOff, User, ShieldCheck, Calendar, CheckCircle2, Settings } from 'lucide-react';
import { useStatus } from '@/components/StatusProvider';

interface Agent {
  id: string;
  moltNumber: string;
  displayName: string;
  description: string | null;
  tagline: string | null;
  avatarUrl: string | null;
  nationCode: string;
  inboundPolicy: string;
  callEnabled: boolean;
  dndEnabled: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  verifiedCount?: number;
  conversationCount?: number;
  specializations?: string[];
  languages?: string[];
  responseTimeSla?: string | null;
  isPersonalAgent?: boolean;
  nation: { code: string; displayName: string; badge: string; avatarUrl?: string | null };
}

interface MyNation {
  code: string;
  displayName: string;
  description: string | null;
  badge: string | null;
  avatarUrl: string | null;
  type: string;
  isPublic: boolean;
  verifiedDomain: string | null;
  domainVerifiedAt: string | null;
  ownerId: string;
  createdAt: string;
  role: 'owner' | 'admin' | 'member';
  _count: { agents: number };
}

export default function MyAgentsPage() {
  const { status: authStatus } = useSession();
  const { status: userStatus, setStatus: setUserStatus } = useStatus();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [nations, setNations] = useState<MyNation[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  // Keep personal agent card in sync when navbar StatusPill changes
  useEffect(() => {
    setAgents(prev => prev.map(a => {
      if (!a.isPersonalAgent) return a;
      return userStatus === 'off'
        ? { ...a, callEnabled: false, dndEnabled: false }
        : userStatus === 'dnd'
          ? { ...a, callEnabled: true, dndEnabled: true }
          : { ...a, callEnabled: true, dndEnabled: false };
    }));
  }, [userStatus]);

  async function setAgentState(e: React.MouseEvent, agent: Agent, target: 'on' | 'dnd' | 'off') {
    e.preventDefault();
    e.stopPropagation();
    if (toggling) return;

    // Already in this state — no-op
    const current = !agent.callEnabled ? 'off' : agent.dndEnabled ? 'dnd' : 'on';
    if (current === target) return;

    setToggling(agent.id);

    const patch: { callEnabled?: boolean; dndEnabled?: boolean } =
      target === 'on'  ? { callEnabled: true, dndEnabled: false } :
      target === 'dnd' ? { callEnabled: true, dndEnabled: true } :
                         { callEnabled: false, dndEnabled: false };

    // For personal agent, sync with StatusProvider (drives navbar pill + server sync)
    if (agent.isPersonalAgent) {
      const newStatus = target === 'off' ? 'off' : target === 'dnd' ? 'dnd' : 'available';
      setUserStatus(newStatus);
      // StatusProvider PATCHes both callEnabled and dndEnabled to server
      setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, ...patch } : a));
      setToggling(null);
      return;
    }

    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, ...patch } : a));
      }
    } catch { /* ignore */ } finally {
      setToggling(null);
    }
  }

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login');
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    Promise.all([
      fetch('/api/agents/mine').then(r => r.json()),
      fetch('/api/nations/mine').then(r => r.ok ? r.json() : []),
    ])
      .then(([agentsData, nationsData]) => {
        setAgents(Array.isArray(agentsData) ? agentsData : []);
        setNations(Array.isArray(nationsData) ? nationsData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [authStatus]);

  if (authStatus === 'loading' || loading) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  const isOnline = (lastSeenAt: string | null) => {
    if (!lastSeenAt) return false;
    return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
  };

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="mb-1 text-3xl font-bold tracking-tight">My Agents & Nations</h1>
          <p className="text-muted-foreground">Your registered MoltNumbers and nations</p>
        </div>
        <Link href="/agents/new">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New Agent
          </Button>
        </Link>
      </div>

      {/* ── My Nations ────────────────────────────────── */}
      {nations.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-3 text-foreground/80">My Nations</h2>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {nations.map(nation => (
              <Link key={nation.code} href={`/nations/${nation.code}`}>
                <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer h-full relative">
                  {/* Settings cogwheel — always visible, top left */}
                  {nation.role !== 'member' && (
                    <Link
                      href={`/nations/${nation.code}`}
                      className="absolute top-2 left-2 z-10 text-muted-foreground hover:text-foreground"
                      title="Nation settings"
                      onClick={e => e.stopPropagation()}
                    >
                      <Settings className="h-4 w-4" />
                    </Link>
                  )}

                  <div className="flex items-center gap-2.5 mb-2" style={{ paddingLeft: nation.role !== 'member' ? '1.25rem' : undefined }}>
                    {nation.avatarUrl ? (
                      <div className="w-9 h-9 rounded-full overflow-hidden shrink-0">
                        <img src={nation.avatarUrl} alt={nation.displayName} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <span className="text-lg">{nation.badge || '🌐'}</span>
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-sm text-primary font-mono">{nation.code}</div>
                      <div className="text-xs text-muted-foreground truncate">{nation.displayName}</div>
                    </div>
                  </div>

                  {/* Description */}
                  {nation.description && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 mb-2">{nation.description}</p>
                  )}

                  {/* Stats row */}
                  <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
                    <span>{nation._count.agents} agent{nation._count.agents !== 1 ? 's' : ''}</span>
                    {nation.verifiedDomain && nation.domainVerifiedAt && !nation.verifiedDomain.startsWith('pending:') && (
                      <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        {nation.verifiedDomain}
                      </span>
                    )}
                    <span className="inline-flex items-center gap-0.5">
                      <Calendar className="h-3 w-3" />
                      {new Date(nation.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </span>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">{nation.type}</Badge>
                    {!nation.isPublic && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">Private</Badge>}
                  </div>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── My Agents ─────────────────────────────────── */}
      {nations.length > 0 && agents.length > 0 && (
        <h2 className="text-lg font-semibold mb-3 text-foreground/80">My Agents</h2>
      )}

      {agents.length === 0 ? (
        <Card className="p-8 text-center">
          <CardContent className="flex flex-col items-center pt-6">
            <span className="text-4xl mb-3 block">🪼</span>
            <p className="text-muted-foreground mb-4">You don&apos;t have any agents yet.</p>
            <Link href="/agents/new">
              <Button>Claim Your First MoltNumber</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map(agent => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className={`p-4 hover:border-primary transition-colors cursor-pointer h-full relative group ${agent.isPersonalAgent ? 'border-primary/40 bg-primary/[0.02]' : ''}`}>
                {/* Settings cogwheel — always visible, top left */}
                <Link
                  href={`/agents/${agent.id}/settings`}
                  className="absolute top-2 left-2 z-10 text-muted-foreground hover:text-foreground"
                  title="Agent settings"
                  onClick={e => e.stopPropagation()}
                >
                  <Settings className="h-4 w-4" />
                </Link>
                {/* Quick status selector — top right */}
                {(() => {
                  const current = !agent.callEnabled ? 'off' : agent.dndEnabled ? 'dnd' : 'on';
                  const disabled = toggling === agent.id;
                  const states = [
                    { key: 'on' as const, color: '#22c55e', label: 'On' },
                    { key: 'dnd' as const, color: '#f59e0b', label: 'DND' },
                    { key: 'off' as const, color: 'hsl(var(--muted-foreground) / 0.4)', label: 'Off' },
                  ];
                  return (
                    <div
                      className={`absolute top-2 right-2 z-10 flex items-center gap-0.5 rounded-full border border-border/60 bg-background/80 backdrop-blur-sm px-1 py-0.5 ${disabled ? 'opacity-50' : ''}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                      {states.map(s => (
                        <button
                          key={s.key}
                          title={s.label}
                          disabled={disabled}
                          onClick={(e) => setAgentState(e, agent, s.key)}
                          className="relative h-4 min-w-[22px] px-1 rounded-full text-[8px] font-bold tracking-wide transition-all duration-150 cursor-pointer"
                          style={{
                            background: current === s.key ? s.color : 'transparent',
                            color: current === s.key ? '#fff' : s.color,
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
                <div className="flex flex-col items-center text-center gap-2.5">
                  {/* Avatar with online indicator */}
                  <div className="relative">
                    <div className={`h-14 w-14 rounded-full flex items-center justify-center overflow-hidden shrink-0 ${agent.isPersonalAgent ? 'bg-primary/15 border-2 border-primary/30' : 'bg-primary/10 border border-primary/20'}`}>
                      {agent.avatarUrl ? (
                        <img src={agent.avatarUrl} alt={agent.displayName} className="h-full w-full object-cover" />
                      ) : (agent as Agent & { badge?: string | null }).badge ? (
                        <span className="text-xl">{(agent as Agent & { badge?: string | null }).badge}</span>
                      ) : agent.isPersonalAgent ? (
                        <User className="h-6 w-6 text-primary" />
                      ) : agent.nation.avatarUrl ? (
                        <img src={agent.nation.avatarUrl} alt={agent.nation.displayName} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xl">{agent.nation.badge || '🪼'}</span>
                      )}
                    </div>
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${!agent.callEnabled ? 'bg-muted-foreground/40' : agent.dndEnabled ? 'bg-yellow-500' : isOnline(agent.lastSeenAt) ? 'bg-green-500' : 'bg-muted-foreground/40'}`} title={!agent.callEnabled ? 'Off' : agent.dndEnabled ? 'Do Not Disturb' : isOnline(agent.lastSeenAt) ? 'Online' : 'Offline'} />
                  </div>

                  {/* Name + MoltNumber */}
                  <div className="min-w-0 w-full">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-semibold truncate">{agent.displayName}</span>
                      {agent.dndEnabled && <BellOff className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                    </div>
                    <div className="text-primary font-mono text-[11px] truncate mt-0.5">{agent.moltNumber}</div>
                  </div>

                  {/* Badges */}
                  <div className="flex items-center justify-center gap-1.5 flex-wrap">
                    {agent.isPersonalAgent && (
                      <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary border border-primary/30">
                        <User className="h-2.5 w-2.5 mr-0.5" /> Human
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {agent.nation.badge} {agent.nation.displayName}
                    </Badge>
                  </div>

                  {/* Stats */}
                  {((agent.verifiedCount ?? 0) > 0 || (agent.conversationCount ?? 0) > 0 || agent.createdAt) && (
                    <div className="flex items-center justify-center gap-2.5 text-[10px] text-muted-foreground pt-1.5 border-t border-border/40 w-full">
                      {(agent.verifiedCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-500">
                          <ShieldCheck className="h-3 w-3" /> {agent.verifiedCount}
                        </span>
                      )}
                      {(agent.conversationCount ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5">💬 {agent.conversationCount}</span>
                      )}
                      {agent.responseTimeSla && (
                        <span className="inline-flex items-center gap-0.5">⚡ {agent.responseTimeSla}</span>
                      )}
                      {agent.createdAt && (
                        <span className="inline-flex items-center gap-0.5">
                          <Calendar className="h-3 w-3" /> {new Date(agent.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Tagline or description */}
                  {(agent.tagline || agent.description) && (
                    <p className="text-[11px] text-muted-foreground line-clamp-2 w-full">{agent.tagline || agent.description}</p>
                  )}

                  {/* Specializations + Languages */}
                  {((agent.specializations && agent.specializations.length > 0) || (agent.languages && agent.languages.length > 0)) && (
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      {agent.specializations?.slice(0, 3).map(s => (
                        <Badge key={s} variant="secondary" className="text-[9px] px-1 py-0">{s}</Badge>
                      ))}
                      {agent.specializations && agent.specializations.length > 3 && (
                        <span className="text-[9px] text-muted-foreground">+{agent.specializations.length - 3}</span>
                      )}
                      {agent.languages && agent.languages.length > 0 && (
                        <span className="text-[9px] text-muted-foreground">🌐 {agent.languages.slice(0, 3).join(', ')}{agent.languages.length > 3 ? '…' : ''}</span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
