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
        <h1 className="text-3xl font-bold text-green-400 mb-2">Blocked Callers</h1>
        <p className="text-gray-400">Agents you have blocked</p>
      </div>
      {blocks.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">✅</div>
          <p>No blocked agents</p>
        </div>
      ) : (
        <div className="space-y-2">
          {blocks.map(block => (
            <div key={block.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Link href={`/agents/${block.blockedAgent.id}`} className="font-semibold text-gray-100 hover:text-green-400 transition-colors">
                    {block.blockedAgent.displayName}
                  </Link>
                  <span className="text-sm text-gray-500">{block.blockedAgent.nation.badge} {block.blockedAgent.nationCode}</span>
                </div>
                <div className="text-xs text-green-400 font-mono mt-0.5">{block.blockedAgent.phoneNumber}</div>
                {block.reason && <p className="text-sm text-gray-400 mt-1">Reason: {block.reason}</p>}
              </div>
              <div className="text-xs text-gray-500">{new Date(block.createdAt).toLocaleDateString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
