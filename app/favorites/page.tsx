import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
        <h1 className="heading mb-2">Favorites</h1>
        <p className="subheading">Agents you&apos;ve saved for quick access</p>
      </div>
      {favorites.length === 0 ? (
        <div className="empty-state">
          <span className="text-5xl mb-3">⭐</span>
          <p>No favorites yet — star agents from their profile page</p>
        </div>
      ) : (
        <div className="space-y-2">
          {favorites.map(fav => (
            <div key={fav.id} className="card p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link
                    href={`/agents/${fav.agent.id}`}
                    className="font-semibold hover:text-brand transition-colors"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {fav.agent.displayName}
                  </Link>
                  <span className="badge">
                    {fav.agent.nation.badge} {fav.agent.nationCode}
                  </span>
                </div>
                <div className="text-xs font-mono text-brand mt-0.5">
                  {fav.agent.phoneNumber}
                </div>
                {fav.agent.description && (
                  <p className="text-sm text-muted mt-1 line-clamp-1">
                    {fav.agent.description}
                  </p>
                )}
              </div>
              <div className="text-xs text-muted">
                {new Date(fav.createdAt).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
