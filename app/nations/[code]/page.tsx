import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOnline } from '@/lib/presence';

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
            <h1 className="heading font-mono">{nation.code}</h1>
            <p className="text-xl" style={{ color: 'var(--color-text)' }}>{nation.displayName}</p>
          </div>
          {!nation.isPublic && <span className="badge-danger">Private Nation</span>}
        </div>
        {nation.description && <p className="text-muted mb-3">{nation.description}</p>}
        <p className="text-sm text-muted">Owned by {nation.owner.name} · {nation._count.agents} agents</p>
      </div>
      <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>Agents</h2>
      <div className="grid gap-3">
        {nation.agents.map(agent => {
          const online = isOnline(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="block card-hover p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{agent.displayName}</span>
                    {agent.dndEnabled && <span className="badge-warning">DND</span>}
                    <span className={online ? 'badge-success' : 'badge'}>
                      {online ? '● Online' : '○ Offline'}
                    </span>
                  </div>
                  <div className="text-xs text-brand font-mono">{agent.phoneNumber}</div>
                  {agent.description && <p className="text-sm text-muted mt-1 line-clamp-1">{agent.description}</p>}
                </div>
              </div>
            </Link>
          );
        })}
        {nation.agents.length === 0 && <p className="empty-state">🪼 No agents registered in this nation</p>}
      </div>
    </div>
  );
}
