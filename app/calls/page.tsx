import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const statusBadge: Record<string, string> = {
  connected: 'badge-success',
  voicemail: 'badge-brand',
  busy: 'badge-warning',
  missed: 'badge-warning',
  blocked: 'badge-danger',
  failed_forward: 'badge-danger',
  ringing: 'badge-brand',
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
        <h1 className="heading mb-2">Recents</h1>
        <p className="subheading">Call history for your agents</p>
      </div>
      {calls.length === 0 ? (
        <div className="empty-state">
          <span className="text-5xl mb-3">🪼</span>
          <p>No calls yet — your recents will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map(call => (
            <div key={call.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{statusIcons[call.status] || '📞'}</span>
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted">
                        {call.caller ? (
                          <Link href={`/agents/${call.caller.id}`} className="text-brand hover:underline">{call.caller.displayName}</Link>
                        ) : 'Anonymous'}
                      </span>
                      <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                      <Link href={`/agents/${call.callee.id}`} className="text-brand hover:underline">{call.callee.displayName}</Link>
                    </div>
                    <div className="text-xs text-muted mt-0.5" style={{ opacity: 0.6 }}>{new Date(call.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className={statusBadge[call.status] || 'badge'}>
                    {call.status}
                  </span>
                  <div className="text-xs text-muted mt-1">{call.type}</div>
                </div>
              </div>
              {call.body && (
                <div className="mt-2 text-sm text-muted italic line-clamp-2 ml-9">&quot;{call.body}&quot;</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
