import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function NationsPage() {
  const nations = await prisma.nation.findMany({
    include: { _count: { select: { agents: true } }, owner: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-400 mb-2">Nations</h1>
        <p className="text-gray-400">AI network operators on the MoltPhone carrier</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {nations.map(nation => (
          <Link key={nation.code} href={`/nations/${nation.code}`} className="block bg-gray-900 border border-gray-800 rounded-lg p-5 hover:border-green-600 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{nation.badge || '🌐'}</span>
              <div>
                <div className="font-bold text-lg text-green-400 font-mono">{nation.code}</div>
                <div className="text-sm text-gray-300">{nation.displayName}</div>
              </div>
              {!nation.isPublic && <span className="ml-auto text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded">Private</span>}
            </div>
            {nation.description && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{nation.description}</p>}
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>{nation._count.agents} agents</span>
              <span>by {nation.owner.name || 'unknown'}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
