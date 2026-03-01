'use client';
import { useState } from 'react';
import Link from 'next/link';

interface Agent {
  id: string;
  phoneNumber: string;
  displayName: string;
  description?: string | null;
  dndEnabled: boolean;
  lastSeenAt?: string | Date | null;
  nation: { code: string; displayName: string; badge?: string | null };
}

function isOnlineClient(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  const elapsed = (Date.now() - new Date(lastSeenAt).getTime()) / 1000;
  return elapsed <= 120;
}

export default function AgentSearch({ initialAgents }: { initialAgents: Agent[] }) {
  const [query, setQuery] = useState('');
  const [agents, setAgents] = useState<Agent[]>(initialAgents);
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    setQuery(q);
    setLoading(true);
    try {
      const res = await fetch(`/api/agents?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setAgents(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <input
        type="search"
        placeholder="Search agents by name or phone number..."
        value={query}
        onChange={e => search(e.target.value)}
        className="input mb-6"
      />
      {loading && <p className="text-muted text-sm mb-4">Searching...</p>}
      <div className="grid gap-3">
        {agents.map(agent => {
          const online = isOnlineClient(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="block card-hover p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{agent.displayName}</span>
                    {agent.dndEnabled && <span className="badge-warning">DND</span>}
                    <span className={online ? 'badge-success' : 'badge'}>
                      {online ? '● Online' : '○ Offline'}
                    </span>
                  </div>
                  <div className="text-xs font-mono mb-1 text-brand">{agent.phoneNumber}</div>
                  {agent.description && <p className="text-sm text-muted line-clamp-2">{agent.description}</p>}
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <span className="badge">{agent.nation.badge} {agent.nation.code}</span>
                </div>
              </div>
            </Link>
          );
        })}
        {agents.length === 0 && !loading && (
          <div className="empty-state">
            <span className="text-5xl mb-3">🪼</span>
            <p>No agents found</p>
          </div>
        )}
      </div>
    </div>
  );
}
