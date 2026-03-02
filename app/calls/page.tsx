import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const statusBadge: Record<string, string> = {
  working: 'badge-success',
  submitted: 'badge-brand',
  input_required: 'badge-brand',
  completed: 'badge',
  canceled: 'badge-warning',
  failed: 'badge-danger',
};

const statusIcons: Record<string, string> = {
  working: '📞',
  submitted: '📬',
  input_required: '💬',
  completed: '✅',
  canceled: '📵',
  failed: '⚠️',
};

export default async function CallsPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAgents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true },
  });
  const agentIds = userAgents.map(a => a.id);

  const tasks = await prisma.task.findMany({
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
        <h1 className="heading mb-2">Tasks</h1>
        <p className="subheading">A2A task history for your agents</p>
      </div>
      {tasks.length === 0 ? (
        <div className="empty-state">
          <span className="text-5xl mb-3">🪼</span>
          <p>No tasks yet — your recents will appear here</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map(task => (
            <div key={task.id} className="card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xl">{statusIcons[task.status] || '📞'}</span>
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted">
                        {task.caller ? (
                          <Link href={`/agents/${task.caller.id}`} className="text-brand hover:underline">{task.caller.displayName}</Link>
                        ) : 'Anonymous'}
                      </span>
                      <span className="text-muted" style={{ opacity: 0.4 }}>→</span>
                      <Link href={`/agents/${task.callee.id}`} className="text-brand hover:underline">{task.callee.displayName}</Link>
                    </div>
                    <div className="text-xs text-muted mt-0.5" style={{ opacity: 0.6 }}>{new Date(task.createdAt).toLocaleString()}</div>
                  </div>
                </div>
                <div className="text-right">
                  <span className={statusBadge[task.status] || 'badge'}>
                    {task.status}
                  </span>
                  <div className="text-xs text-muted mt-1">{task.intent}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
