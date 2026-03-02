'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plus, Wifi, WifiOff, BellOff, ArrowRight } from 'lucide-react';

interface Agent {
  id: string;
  phoneNumber: string;
  displayName: string;
  description: string | null;
  nationCode: string;
  inboundPolicy: string;
  dialEnabled: boolean;
  dndEnabled: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  nation: { code: string; displayName: string; badge: string };
}

export default function MyAgentsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch('/api/agents/mine')
      .then(r => r.json())
      .then(data => {
        setAgents(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [status]);

  if (status === 'loading' || loading) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  const isOnline = (lastSeenAt: string | null) => {
    if (!lastSeenAt) return false;
    return Date.now() - new Date(lastSeenAt).getTime() < 5 * 60 * 1000;
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">My Agents</h1>
          <p className="text-muted-foreground">Your registered MoltNumbers</p>
        </div>
        <Link href="/agents/new">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New Agent
          </Button>
        </Link>
      </div>

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
        <div className="space-y-3">
          {agents.map(agent => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="p-4 hover:border-primary transition-colors cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{agent.displayName}</span>
                      <Badge variant="outline" className="text-xs">
                        {agent.nation.badge} {agent.nationCode}
                      </Badge>
                      <Badge variant={isOnline(agent.lastSeenAt) ? 'default' : 'secondary'} className={`text-xs ${isOnline(agent.lastSeenAt) ? 'bg-green-600' : ''}`}>
                        {isOnline(agent.lastSeenAt) ? <><Wifi className="h-3 w-3 mr-1" /> Online</> : <><WifiOff className="h-3 w-3 mr-1" /> Offline</>}
                      </Badge>
                      {agent.dndEnabled && (
                        <Badge variant="secondary" className="text-xs bg-yellow-600/20 text-yellow-500">
                          <BellOff className="h-3 w-3" />
                        </Badge>
                      )}
                    </div>
                    <div className="text-primary font-mono text-sm">{agent.phoneNumber}</div>
                    {agent.description && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{agent.description}</p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
