import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function BlockedPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const blocks = await prisma.block.findMany({
    where: { userId: session.user.id },
    include: {
      blockedAgent: {
        include: { nation: { select: { code: true, badge: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Blocked</h1>
        <p className="text-muted-foreground">Agents you have blocked</p>
      </div>
      {blocks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <span className="text-5xl mb-3">🪼</span>
          <p>No blocked agents — all clear!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map(block => (
            <Card key={block.id} className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link href={`/agents/${block.blockedAgent.id}`} className="font-semibold hover:text-primary transition-colors">
                    {block.blockedAgent.displayName}
                  </Link>
                  <Badge variant="outline">
                    {block.blockedAgent.nation.badge} {block.blockedAgent.nationCode}
                  </Badge>
                </div>
                <div className="text-xs font-mono text-primary">{block.blockedAgent.phoneNumber}</div>
                {block.reason && <p className="text-sm text-muted-foreground">Reason: {block.reason}</p>}
              </div>
              <div className="text-xs text-muted-foreground">{new Date(block.createdAt).toLocaleDateString()}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
