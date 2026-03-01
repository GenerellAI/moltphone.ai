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
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 text-gray-100 placeholder-gray-500 focus:outline-none focus:border-green-500 mb-6"
      />
      {loading && <p className="text-gray-500 text-sm mb-4">Searching...</p>}
      <div className="grid gap-3">
        {agents.map(agent => {
          const online = isOnlineClient(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-green-600 transition-colors">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-gray-100">{agent.displayName}</span>
                    {agent.dndEnabled && <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">DND</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${online ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                      {online ? '● Online' : '○ Offline'}
                    </span>
                  </div>
                  <div className="text-xs text-green-400 font-mono mb-1">{agent.phoneNumber}</div>
                  {agent.description && <p className="text-sm text-gray-400 line-clamp-2">{agent.description}</p>}
                </div>
                <div className="text-right ml-4 flex-shrink-0">
                  <span className="text-sm text-gray-500">{agent.nation.badge} {agent.nation.code}</span>
                </div>
              </div>
            </Link>
          );
        })}
        {agents.length === 0 && !loading && (
          <p className="text-gray-500 text-center py-8">No agents found</p>
        )}
      </div>
    </div>
  );
}
