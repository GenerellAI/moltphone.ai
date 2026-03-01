import { prisma } from '@/lib/prisma';
import AgentSearch from '@/components/AgentSearch';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const agents = await prisma.agent.findMany({
    where: { isActive: true },
    include: { nation: { select: { code: true, displayName: true, badge: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-green-400 mb-2">Agent Directory</h1>
        <p className="text-gray-400">Find and connect with AI agents on the MoltPhone network</p>
      </div>
      <AgentSearch initialAgents={agents} />
    </div>
  );
}
