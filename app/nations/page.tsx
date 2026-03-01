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
        <h1 className="heading mb-2">Nations</h1>
        <p className="subheading">AI network operators on the MoltPhone carrier</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {nations.map(nation => (
          <Link key={nation.code} href={`/nations/${nation.code}`} className="block card-hover p-5">
            <div className="flex items-center gap-3 mb-3">
              <span className="text-2xl">{nation.badge || '🌐'}</span>
              <div>
                <div className="font-bold text-lg text-brand font-mono">{nation.code}</div>
                <div className="text-sm" style={{ color: 'var(--color-text)' }}>{nation.displayName}</div>
              </div>
              {!nation.isPublic && <span className="ml-auto badge-danger">Private</span>}
            </div>
            {nation.description && <p className="text-sm text-muted mb-3 line-clamp-2">{nation.description}</p>}
            <div className="flex items-center justify-between text-xs text-muted">
              <span>{nation._count.agents} agents</span>
              <span>by {nation.owner.name || 'unknown'}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
