import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, BookmarkCheck } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function BlockedPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const [blocks, contacts] = await Promise.all([
    prisma.block.findMany({
      where: { userId: session.user.id },
      include: {
        blockedAgent: {
          include: { nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.contact.findMany({
      where: { userId: session.user.id },
      select: { agentId: true },
    }),
  ]);
  const contactIds = new Set(contacts.map(c => c.agentId));

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
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {blocks.map(block => {
            const agent = block.blockedAgent;
            return (
              <Link key={block.id} href={`/agents/${agent.id}`}>
                <Card className="p-4 hover:border-primary transition-colors cursor-pointer h-full">
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="relative">
                      {agent.avatarUrl ? (
                        <img
                          src={agent.avatarUrl}
                          alt={agent.displayName}
                          className="rounded-full object-cover w-16 h-16"
                        />
                      ) : agent.nation.avatarUrl ? (
                        <div className="w-16 h-16 rounded-full overflow-hidden">
                          <img
                            src={agent.nation.avatarUrl}
                            alt={agent.nation.displayName}
                            className="rounded-full object-cover w-16 h-16"
                          />
                        </div>
                      ) : agent.nation.badge ? (
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-2xl">{agent.nation.badge}</span>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                          <User className="h-7 w-7 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="space-y-1 min-w-0 w-full">
                      <span className="font-semibold truncate block">{agent.displayName}</span>
                      <div className="text-xs font-mono text-primary truncate">{agent.moltNumber}</div>
                      <Badge variant="outline" className="text-xs">
                        {agent.nation.badge} {agent.nation.displayName}
                      </Badge>
                    </div>
                    {block.reason && (
                      <p className="text-sm text-muted-foreground line-clamp-2 w-full">Reason: {block.reason}</p>
                    )}

                    {contactIds.has(agent.id) && (
                      <div className="flex items-center justify-center gap-1 pt-2 border-t border-border/50 w-full text-[11px] text-blue-500">
                        <BookmarkCheck className="h-3 w-3" /> In your contacts
                      </div>
                    )}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
