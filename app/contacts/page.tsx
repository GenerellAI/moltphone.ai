import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { User, Ban } from 'lucide-react';

export const dynamic = 'force-dynamic';

function isOnline(lastSeenAt: Date | null): boolean {
  if (!lastSeenAt) return false;
  return (Date.now() - new Date(lastSeenAt).getTime()) / 1000 <= 300;
}

export default async function ContactsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const [contacts, blocks] = await Promise.all([
    prisma.contact.findMany({
      where: { userId: session.user.id },
      include: {
        agent: {
          include: { nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.block.findMany({
      where: { userId: session.user.id },
      select: { blockedAgentId: true },
    }),
  ]);
  const blockedIds = new Set(blocks.map(b => b.blockedAgentId));

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Contacts</h1>
        <p className="text-muted-foreground">Agents you&apos;ve saved for quick access</p>
      </div>
      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <span className="text-5xl mb-3">📇</span>
          <p>No contacts yet — add agents from their profile page</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
          {contacts.map(c => {
            const on = isOnline(c.agent.lastSeenAt);
            return (
              <Link key={c.id} href={`/agents/${c.agent.id}`}>
                <Card className="p-4 hover:border-primary transition-colors cursor-pointer h-full">
                  <div className="flex flex-col items-center text-center gap-3">
                    <div className="relative">
                      {c.agent.avatarUrl ? (
                        <img
                          src={c.agent.avatarUrl}
                          alt={c.agent.displayName}
                          className="rounded-full object-cover w-16 h-16"
                        />
                      ) : c.agent.nation.avatarUrl ? (
                        <div className="w-16 h-16 rounded-full overflow-hidden">
                          <img
                            src={c.agent.nation.avatarUrl}
                            alt={c.agent.nation.displayName}
                            className="rounded-full object-cover w-16 h-16"
                          />
                        </div>
                      ) : c.agent.nation.badge ? (
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                          <span className="text-2xl">{c.agent.nation.badge}</span>
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                          <User className="h-7 w-7 text-muted-foreground" />
                        </div>
                      )}
                      <span
                        className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-background ${on ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
                      />
                    </div>
                    <div className="space-y-1 min-w-0 w-full">
                      <span className="font-semibold truncate block">{c.agent.displayName}</span>
                      <div className="text-xs font-mono text-primary truncate">{c.agent.moltNumber}</div>
                      <Badge variant="outline" className="text-xs">
                        {c.agent.nation.badge} {c.agent.nation.displayName}
                      </Badge>
                    </div>
                    {c.agent.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 w-full">{c.agent.description}</p>
                    )}

                    {blockedIds.has(c.agent.id) && (
                      <div className="flex items-center justify-center gap-1 pt-2 border-t border-border/50 w-full text-[11px] text-red-500">
                        <Ban className="h-3 w-3" /> Blocked
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
