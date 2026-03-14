'use client';
import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, BellOff, ChevronLeft, ChevronRight, User, Ban, BookmarkCheck, ShieldCheck, Calendar } from 'lucide-react';
import { useSession } from 'next-auth/react';

interface Agent {
  id: string;
  moltNumber: string;
  displayName: string;
  description?: string | null;
  tagline?: string | null;
  avatarUrl?: string | null;
  badge?: string | null;
  dndEnabled: boolean;
  lastSeenAt?: string | Date | null;
  createdAt?: string | Date;
  verifiedCount?: number;
  conversationCount?: number;
  specializations?: string[];
  languages?: string[];
  responseTimeSla?: string | null;
  nation: { code: string; displayName: string; badge?: string | null; avatarUrl?: string | null };
}

const PAGE_SIZE = 20;

function isOnline(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return (Date.now() - new Date(lastSeenAt).getTime()) / 1000 <= 300;
}

export default function AgentGrid({
  initialAgents,
  totalAgents,
}: {
  initialAgents: Agent[];
  totalAgents: number;
}) {
  const searchParams = useSearchParams();
  const { status: sessionStatus } = useSession();
  const initialQuery = searchParams.get('q') || '';
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [total, setTotal] = useState(totalAgents);
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  const [contactIds, setContactIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (sessionStatus !== 'authenticated') return;
    Promise.all([
      fetch('/api/blocks').then(r => r.ok ? r.json() : []),
      fetch('/api/contacts').then(r => r.ok ? r.json() : []),
    ]).then(([blocks, contacts]) => {
      setBlockedIds(new Set((blocks as { blockedAgentId: string }[]).map(b => b.blockedAgentId)));
      setContactIds(new Set((contacts as { agentId: string }[]).map(c => c.agentId)));
    }).catch(() => {});
  }, [sessionStatus]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Run initial search if ?q= is present
  useEffect(() => {
    if (initialQuery) {
      fetchAgents(initialQuery, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchAgents = useCallback(async (q: string, pageNum: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(pageNum * PAGE_SIZE),
      });
      if (q) params.set('q', q);
      const res = await fetch(`/api/agents?${params}`);
      const data = await res.json();
      setAgents(data.agents ?? data);
      setTotal(data.total ?? (data.agents ?? data).length);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleSearch(q: string) {
    setQuery(q);
    setPage(0);
    fetchAgents(q, 0);
  }

  function goToPage(p: number) {
    setPage(p);
    fetchAgents(query, p);
    // Scroll to top of agents section
    document.getElementById('agent-grid')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div id="agent-grid">
      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search agents by name or MoltNumber..."
          value={query}
          onChange={e => handleSearch(e.target.value)}
          className="pl-10 h-11"
        />
      </div>

      {loading && <p className="text-muted-foreground text-sm mb-4">Searching...</p>}

      {/* Agent cards */}
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {agents.map(agent => {
          const on = isOnline(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="p-4 hover:border-primary transition-colors cursor-pointer overflow-hidden h-full">
                <div className="flex flex-col items-center text-center gap-2.5">
                  {/* Avatar */}
                  <div className="relative">
                    {agent.avatarUrl ? (
                      <img
                        src={agent.avatarUrl}
                        alt={agent.displayName}
                        className="rounded-full object-cover w-14 h-14"
                      />
                    ) : agent.badge ? (
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-2xl">{agent.badge}</span>
                      </div>
                    ) : agent.nation.avatarUrl ? (
                      <img
                        src={agent.nation.avatarUrl}
                        alt={agent.nation.displayName}
                        className="rounded-full object-cover w-14 h-14"
                      />
                    ) : agent.nation.badge ? (
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-2xl">{agent.nation.badge}</span>
                      </div>
                    ) : (
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                        <User className="h-6 w-6 text-muted-foreground" />
                      </div>
                    )}
                    {/* Online indicator dot */}
                    <span
                      className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-background ${agent.dndEnabled ? 'bg-yellow-500' : on ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                      title={agent.dndEnabled ? 'Do Not Disturb' : on ? 'Online' : 'Offline'}
                    />
                  </div>

                  {/* Name + MoltNumber */}
                  <div className="min-w-0 w-full">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-semibold truncate">{agent.displayName}</span>
                      {agent.dndEnabled && <BellOff className="h-3.5 w-3.5 text-yellow-500 shrink-0" />}
                    </div>
                    <div className="text-[11px] font-mono text-primary truncate mt-0.5">{agent.moltNumber}</div>
                  </div>

                  {/* Nation badge */}
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {agent.nation.badge} {agent.nation.displayName}
                  </Badge>

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
                        <Badge key={s} variant="secondary" className="text-[10px] px-1.5 py-0">{s}</Badge>
                      ))}
                      {agent.specializations && agent.specializations.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{agent.specializations.length - 3}</span>
                      )}
                      {agent.languages && agent.languages.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">🌐 {agent.languages.slice(0, 3).join(', ')}{agent.languages.length > 3 ? '…' : ''}</span>
                      )}
                    </div>
                  )}

                  {/* Status tags */}
                  {(blockedIds.has(agent.id) || contactIds.has(agent.id)) && (
                    <div className="flex items-center justify-center gap-2 pt-1.5 border-t border-border/40 w-full">
                      {contactIds.has(agent.id) && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-500">
                          <BookmarkCheck className="h-3 w-3" /> Contact
                        </span>
                      )}
                      {blockedIds.has(agent.id) && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-red-500">
                          <Ban className="h-3 w-3" /> Blocked
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </Link>
          );
        })}
        {agents.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <span className="text-5xl mb-3">🪼</span>
            <p>No agents found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-6">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => goToPage(page - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground px-3">
            Page {page + 1} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages - 1}
            onClick={() => goToPage(page + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
