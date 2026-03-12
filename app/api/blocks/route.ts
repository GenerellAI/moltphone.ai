import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const blocks = await prisma.block.findMany({
    where: { userId: session.user.id },
    include: { blockedAgent: { include: { nation: { select: { code: true, displayName: true, badge: true } } } } },
  });
  return NextResponse.json(blocks);
}

const postSchema = z.object({
  agentId: z.string(),
  reason: z.string().optional(),
  // Report fields
  report: z.boolean().optional(),
  reportReasons: z.array(z.string()).optional(),
  reportDetails: z.string().max(1000).optional(),
  // Bulk blocking
  blockOwnerAgents: z.boolean().optional(),
  blockNation: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  
  const body = postSchema.parse(await req.json());
  const userId = session.user.id;

  // Build the reason string from report data
  let reason = body.reason;
  if (body.report && body.reportReasons?.length) {
    reason = `[Report] ${body.reportReasons.join(', ')}`;
    if (body.reportDetails) reason += ` — ${body.reportDetails}`;
  }

  // Collect all agent IDs to block
  const agentIdsToBlock = new Set<string>([body.agentId]);

  // Block all agents from the same owner
  if (body.blockOwnerAgents) {
    const targetAgent = await prisma.agent.findUnique({
      where: { id: body.agentId },
      select: { ownerId: true },
    });
    if (targetAgent?.ownerId) {
      const ownerAgents = await prisma.agent.findMany({
        where: { ownerId: targetAgent.ownerId, isActive: true },
        select: { id: true },
      });
      for (const a of ownerAgents) agentIdsToBlock.add(a.id);
    }
  }

  // Block all agents from the same nation
  if (body.blockNation) {
    const targetAgent = await prisma.agent.findUnique({
      where: { id: body.agentId },
      select: { nationCode: true },
    });
    if (targetAgent?.nationCode) {
      const nationAgents = await prisma.agent.findMany({
        where: { nationCode: targetAgent.nationCode, isActive: true },
        select: { id: true },
        take: 500, // Safety cap
      });
      for (const a of nationAgents) agentIdsToBlock.add(a.id);
    }
  }

  // Upsert blocks for all agents
  const results = await prisma.$transaction(
    Array.from(agentIdsToBlock).map(agentId =>
      prisma.block.upsert({
        where: { userId_blockedAgentId: { userId, blockedAgentId: agentId } },
        create: { userId, blockedAgentId: agentId, reason: agentId === body.agentId ? reason : `Bulk blocked (via ${body.agentId})` },
        update: { reason: agentId === body.agentId ? reason : undefined },
      })
    )
  );

  return NextResponse.json({ blocked: results.length }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { agentId } = z.object({ agentId: z.string() }).parse(await req.json());

  await prisma.block.deleteMany({
    where: { userId: session.user.id, blockedAgentId: agentId },
  });
  return NextResponse.json({ ok: true });
}
