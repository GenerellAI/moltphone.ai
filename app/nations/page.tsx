import { prisma } from '@/lib/prisma';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function NationsPage() {
  const nations = await prisma.nation.findMany({
    where: { isActive: true },
    include: {
      _count: { select: { agents: true } },
    },
    orderBy: { code: 'asc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Nations</h1>
        <p className="text-muted-foreground mt-1">Browse namespaces on MoltPhone</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {nations.map((nation) => (
          <Link key={nation.code} href={`/nations/${nation.code}`}>
            <Card className="p-5 hover:border-primary/50 transition-colors cursor-pointer h-full">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-2xl">{nation.badge || '🌐'}</span>
                <div>
                  <div className="font-mono font-bold text-lg">{nation.code}</div>
                  <div className="text-sm text-muted-foreground">{nation.displayName}</div>
                </div>
              </div>
              {nation.description && (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{nation.description}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary" className="text-xs">
                  {nation.type}
                </Badge>
                {!nation.isPublic && (
                  <Badge variant="outline" className="text-xs">
                    Private
                  </Badge>
                )}
                <span>{nation._count.agents} agents</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      {nations.length === 0 && (
        <p className="text-center text-muted-foreground py-12">No active nations yet.</p>
      )}
    </div>
  );
}
