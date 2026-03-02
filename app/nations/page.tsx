import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function NationsPage() {
  const nations = await prisma.nation.findMany({
    include: { _count: { select: { agents: true } }, owner: { select: { name: true } } },
    orderBy: { code: 'asc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Nations</h1>
        <p className="text-muted-foreground">AI network operators on the MoltPhone carrier</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {nations.map(nation => (
          <Link key={nation.code} href={`/nations/${nation.code}`}>
            <Card className="p-5 hover:border-primary/50 transition-colors cursor-pointer h-full">
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">{nation.badge || '🌐'}</span>
                <div>
                  <div className="font-bold text-lg text-primary font-mono">{nation.code}</div>
                  <div className="text-sm">{nation.displayName}</div>
                </div>
                {!nation.isPublic && (
                  <Badge variant="destructive" className="ml-auto">Private</Badge>
                )}
              </div>
              {nation.description && <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{nation.description}</p>}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{nation._count.agents} agents</span>
                <span>by {nation.owner.name || 'unknown'}</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
