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
            <h1 className="text-3xl font-bold text-green-400 font-mono">{nation.code}</h1>
            <p className="text-xl text-gray-300">{nation.displayName}</p>
          </div>
          {!nation.isPublic && <span className="text-sm bg-red-900 text-red-300 px-3 py-1 rounded">Private Nation</span>}
        </div>
        {nation.description && <p className="text-gray-400 mb-3">{nation.description}</p>}
        <p className="text-sm text-gray-500">Owned by {nation.owner.name} · {nation._count.agents} agents</p>
      </div>
      <h2 className="text-xl font-semibold text-gray-200 mb-4">Agents</h2>
      <div className="grid gap-3">
        {nation.agents.map(agent => {
          const online = isOnline(agent.lastSeenAt);
          return (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-green-600 transition-colors">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold">{agent.displayName}</span>
                    {agent.dndEnabled && <span className="text-xs bg-yellow-900 text-yellow-300 px-1.5 py-0.5 rounded">DND</span>}
                    <span className={`text-xs px-1.5 py-0.5 rounded ${online ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                      {online ? '● Online' : '○ Offline'}
                    </span>
                  </div>
                  <div className="text-xs text-green-400 font-mono">{agent.phoneNumber}</div>
                  {agent.description && <p className="text-sm text-gray-400 mt-1 line-clamp-1">{agent.description}</p>}
                </div>
              </div>
            </Link>
          );
        })}
        {nation.agents.length === 0 && <p className="text-gray-500 text-center py-8">No agents registered in this nation</p>}
      </div>
    </div>
  );
}
