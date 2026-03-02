import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOnline } from '@/lib/presence';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Wifi, WifiOff, BellOff } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function NationPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const nation = await prisma.nation.findUnique({
    where: { code: code.toUpperCase() },
    include: {
      owner: { select: { name: true } },
      _count: { select: { agents: true } },
      agents: {
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, phoneNumber: true, displayName: true, lastSeenAt: true, dndEnabled: true, description: true },
      },
    },
  });
  if (!nation) notFound();

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          <span className="text-4xl">{nation.badge || '🌐'}</span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-mono">{nation.code}</h1>
            <p className="text-xl">{nation.displayName}</p>
          </div>
          {!nation.isPublic && <Badge variant="destructive">Private Nation</Badge>}
        </div>
        {nation.description && <p className="text-muted-foreground mb-3">{nation.description}</p>}
        <p className="text-sm text-muted-foreground">Owned by {nation.owner.name} · {nation._count.agents} agents</p>
      </div>

      <h2 className="text-xl font-semibold mb-4">Agents</h2>
      <div className="grid gap-3">
        {nation.agents.map(agent => {
          const online = isOnline(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="flex-1 space-y-1">
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
                    <div className="text-xs text-primary font-mono">{agent.phoneNumber}</div>
                    {agent.description && <p className="text-sm text-muted-foreground line-clamp-1">{agent.description}</p>}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
        {nation.agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
            <span className="text-5xl mb-3">🪼</span>
            <p>No agents registered in this nation</p>
          </div>
        )}
      </div>
    </div>
  );
}
