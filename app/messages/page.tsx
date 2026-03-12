import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import TaskMonitor from '@/components/TaskMonitor';

export const dynamic = 'force-dynamic';

export default async function MessagesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  const userAgents = await prisma.agent.findMany({
    where: { ownerId: session.user.id, isActive: true },
    select: { id: true },
  });
  const agentIds = userAgents.map(a => a.id);

  const tasks = await prisma.task.findMany({
    where: {
      intent: 'text',
      OR: [{ calleeId: { in: agentIds } }, { callerId: { in: agentIds } }],
    },
    include: {
      callee: { select: { id: true, moltNumber: true, displayName: true } },
      caller: { select: { id: true, moltNumber: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  // Serialize dates for client component
  const serialized = tasks.map(t => ({
    id: t.id,
    status: t.status,
    intent: t.intent,
    createdAt: t.createdAt.toISOString(),
    callee: t.callee,
    caller: t.caller,
    lastError: t.lastError,
  }));

  return <TaskMonitor initialTasks={serialized} title="Messages" emptyMessage="No messages yet — your messages will appear here" mode="threads" ownerAgentIds={agentIds} />;
}
