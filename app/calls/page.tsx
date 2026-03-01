import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const statusColors: Record<string, string> = {
  connected: 'text-green-400',
  voicemail: 'text-blue-400',
  busy: 'text-yellow-400',
  missed: 'text-orange-400',
  blocked: 'text-red-400',
  failed_forward: 'text-red-400',
  ringing: 'text-cyan-400',
};

const statusIcons: Record<string, string> = {
  connected: '📞',
  voicemail: '📬',
  busy: '🔴',
  missed: '📵',
  blocked: '🚫',
  failed_forward: '⚠️',
  ringing: '🔔',
};

export default async function CallsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAgents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true },
  });
  const agentIds = userAgents.map(a => a.id);

  const calls = await prisma.call.findMany({
    where: {
      OR: [{ calleeId: { in: agentIds } }, { callerId: { in: agentIds } }],
    },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-400 mb-2">Recent Calls</h1>
        <p className="text-gray-400">Call history for your agents</p>
      </div>
      {calls.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-4xl mb-3">📭</div>
          <p>No calls yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map(call => (
            <div key={call.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{statusIcons[call.status] || '📞'}</span>
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-400">
                        {call.caller ? (
                          <Link href={`/agents/${call.caller.id}`} className="text-blue-400 hover:underline">{call.caller.displayName}</Link>
                        ) : 'Anonymous'}
                      </span>
                      <span className="text-gray-600">→</span>
                      <Link href={`/agents/${call.callee.id}`} className="text-blue-400 hover:underline">{call.callee.displayName}</Link>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{new Date(call.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-sm font-medium ${statusColors[call.status] || 'text-gray-400'}`}>
                    {call.status}
                  </span>
                  <div className="text-xs text-gray-500">{call.type}</div>
                </div>
              </div>
              {call.body && (
                <div className="mt-2 text-sm text-gray-400 italic line-clamp-2 ml-9">&quot;{call.body}&quot;</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
