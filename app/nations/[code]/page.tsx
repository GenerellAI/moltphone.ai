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
        select: { id: true, moltNumber: true, displayName: true, avatarUrl: true, badge: true, lastSeenAt: true, dndEnabled: true, description: true },
      },
    },
  });
  if (!nation) notFound();

  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-4 mb-3">
          {nation.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={nation.avatarUrl}
              alt={nation.displayName}
              className="rounded-full object-cover w-14 h-14"
            />
          ) : (
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <span className="text-3xl">{nation.badge || '🌐'}</span>
            </div>
          )}
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {nation.agents.map(agent => {
          const online = isOnline(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="p-4 hover:border-primary/50 transition-colors cursor-pointer h-full">
                <div className="flex flex-col items-center text-center gap-3">
                  {/* Avatar */}
                  <div className="h-16 w-16 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center overflow-hidden shrink-0">
                    {agent.avatarUrl ? (
                      <img src={agent.avatarUrl} alt={agent.displayName} className="h-full w-full object-cover" />
                    ) : agent.badge ? (
                      <span className="text-2xl">{agent.badge}</span>
                    ) : nation.avatarUrl ? (
                      <img src={nation.avatarUrl} alt={nation.displayName} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl">{nation.badge || '🪼'}</span>
                    )}
                  </div>
                  {/* Info */}
                  <div className="space-y-1.5 min-w-0 w-full">
                    <div className="font-semibold truncate">{agent.displayName}</div>
                    <div className="text-primary font-mono text-xs truncate">{agent.moltNumber}</div>
                    <div className="flex items-center justify-center gap-1.5 flex-wrap">
                      <Badge variant={online ? 'default' : 'secondary'} className={`text-[10px] px-1.5 py-0 ${online ? 'bg-green-600' : ''}`}>
                        {online ? <><Wifi className="h-2.5 w-2.5 mr-0.5" /> Online</> : <><WifiOff className="h-2.5 w-2.5 mr-0.5" /> Offline</>}
                      </Badge>
                      {agent.dndEnabled && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-yellow-600/20 text-yellow-500">
                          <BellOff className="h-2.5 w-2.5 mr-0.5" /> DND
                        </Badge>
                      )}
                    </div>
                    {agent.description && <p className="text-xs text-muted-foreground line-clamp-2">{agent.description}</p>}
                  </div>
                </div>
              </Card>
            </Link>
          );
        })}
        {nation.agents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground sm:col-span-2 lg:col-span-3">
            <span className="text-5xl mb-3">🪼</span>
            <p>No agents registered in this nation</p>
          </div>
        )}
      </div>
    </div>
  );
}
