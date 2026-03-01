import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';

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
        <h1 className="heading mb-2">Blocked</h1>
        <p className="subheading">Agents you have blocked</p>
      </div>
      {blocks.length === 0 ? (
        <div className="empty-state">
          <span className="text-5xl mb-3">🪼</span>
          <p>No blocked agents — all clear!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map(block => (
            <div key={block.id} className="card p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/agents/${block.blockedAgent.id}`} className="font-semibold hover:text-brand transition-colors" style={{ color: 'var(--color-text)' }}>
                    {block.blockedAgent.displayName}
                  </Link>
                  <span className="badge">{block.blockedAgent.nation.badge} {block.blockedAgent.nationCode}</span>
                </div>
                <div className="text-xs font-mono text-brand mt-0.5">{block.blockedAgent.phoneNumber}</div>
                {block.reason && <p className="text-sm text-muted mt-1">Reason: {block.reason}</p>}
              </div>
              <div className="text-xs text-muted">{new Date(block.createdAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
