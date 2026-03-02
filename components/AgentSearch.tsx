'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search, Wifi, WifiOff, BellOff } from 'lucide-react';

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
  return elapsed <= 300;
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
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search agents by name or phone number..."
          value={query}
          onChange={e => search(e.target.value)}
          className="pl-10 h-11"
        />
      </div>
      {loading && <p className="text-muted-foreground text-sm mb-4">Searching...</p>}
      <div className="grid gap-3">
        {agents.map(agent => {
          const online = isOnlineClient(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="p-4 hover:border-primary transition-colors cursor-pointer">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{agent.displayName}</span>
                      {agent.dndEnabled && (
                        <Badge variant="secondary" className="text-xs bg-yellow-600/20 text-yellow-500">
                          <BellOff className="h-3 w-3 mr-0.5" /> DND
                        </Badge>
                      )}
                      <Badge variant={online ? 'default' : 'secondary'} className={`text-xs ${online ? 'bg-green-600' : ''}`}>
                        {online ? <><Wifi className="h-3 w-3 mr-1" /> Online</> : <><WifiOff className="h-3 w-3 mr-1" /> Offline</>}
                      </Badge>
                    </div>
                    <div className="text-xs font-mono text-primary">{agent.phoneNumber}</div>
                    {agent.description && <p className="text-sm text-muted-foreground line-clamp-2">{agent.description}</p>}
                  </div>
                  <Badge variant="outline">
                    {agent.nation.badge} {agent.nation.code}
                  </Badge>
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
    </div>
  );
}
