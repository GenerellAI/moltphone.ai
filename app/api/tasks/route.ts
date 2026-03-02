import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/tasks — List tasks for the authenticated user's agents.
 *
 * Query params:
 *   agentId  — filter to a single agent
 *   status   — filter by task status (comma-separated)
 *   limit    — max results (default 50, max 200)
 *   cursor   — pagination cursor (task ID)
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const agentIdFilter = url.searchParams.get('agentId');
  const statusFilter = url.searchParams.get('status');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  const cursor = url.searchParams.get('cursor');

  // Get user's agent IDs (or validate the specific agentId belongs to user)
  let agentIds: string[];
  if (agentIdFilter) {
    const agent = await prisma.agent.findFirst({
      where: { id: agentIdFilter, ownerId: session.user.id, isActive: true },
      select: { id: true },
    });
    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    agentIds = [agent.id];
  } else {
    const agents = await prisma.agent.findMany({
      where: { ownerId: session.user.id, isActive: true },
      select: { id: true },
    });
    agentIds = agents.map(a => a.id);
  }

  const statusValues = statusFilter?.split(',').map(s => s.trim()).filter(Boolean);

  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { calleeId: { in: agentIds } },
        { callerId: { in: agentIds } },
      ],
      ...(statusValues?.length ? { status: { in: statusValues as never[] } } : {}),
    },
    include: {
      callee: { select: { id: true, phoneNumber: true, displayName: true } },
      caller: { select: { id: true, phoneNumber: true, displayName: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = tasks.length > limit;
  const items = hasMore ? tasks.slice(0, limit) : tasks;

  return NextResponse.json({
    tasks: items,
    nextCursor: hasMore ? items[items.length - 1].id : null,
  });
}
