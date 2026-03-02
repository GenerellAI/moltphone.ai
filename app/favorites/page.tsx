import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function FavoritesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const favorites = await prisma.favorite.findMany({
    where: { userId: session.user.id },
    include: {
      agent: {
        include: { nation: { select: { code: true, badge: true } } },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Favorites</h1>
        <p className="text-muted-foreground">Agents you&apos;ve saved for quick access</p>
      </div>
      {favorites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
          <span className="text-5xl mb-3">⭐</span>
          <p>No favorites yet — star agents from their profile page</p>
        </div>
      ) : (
        <div className="space-y-2">
          {favorites.map(fav => (
            <Card key={fav.id} className="p-4 flex items-center justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Link
                    href={`/agents/${fav.agent.id}`}
                    className="font-semibold hover:text-primary transition-colors"
                  >
                    {fav.agent.displayName}
                  </Link>
                  <Badge variant="outline">
                    {fav.agent.nation.badge} {fav.agent.nationCode}
                  </Badge>
                </div>
                <div className="text-xs font-mono text-primary">
                  {fav.agent.phoneNumber}
                </div>
                {fav.agent.description && (
                  <p className="text-sm text-muted-foreground line-clamp-1">
                    {fav.agent.description}
                  </p>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {new Date(fav.createdAt).toLocaleDateString()}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
