/**
 * GET  /api/agents/:id/lexicon — List lexicon entries (owner-only)
 * POST /api/agents/:id/lexicon — Add entry or batch of entries (owner-only)
 *
 * Limits: 500 entries per agent, 100 per batch, 100 chars per term/variant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';

const MAX_ENTRIES_PER_AGENT = 500;
const MAX_BATCH_SIZE = 100;

const entrySchema = z.object({
  type: z.enum(['vocabulary', 'correction']),
  term: z.string().min(1).max(100).trim(),
  variant: z.string().max(100).trim().optional().default(''),
}).refine(
  (e) => e.type === 'vocabulary' || (e.type === 'correction' && e.variant && e.variant.length > 0),
  { message: 'Correction entries require a non-empty variant (the misspelling)' },
);

const batchSchema = z.object({
  entries: z.array(entrySchema).min(1).max(MAX_BATCH_SIZE),
});

async function resolveAgent(id: string, userId: string) {
  const agent = await prisma.agent.findUnique({ where: { id, isActive: true }, select: { id: true, ownerId: true } });
  if (!agent) return { error: 'Agent not found', status: 404 } as const;
  if (agent.ownerId !== userId) return { error: 'Forbidden', status: 403 } as const;
  return { agent } as const;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const result = await resolveAgent(id, session.user.id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const entries = await prisma.lexiconEntry.findMany({
    where: { agentId: id },
    orderBy: [{ type: 'asc' }, { term: 'asc' }],
  });

  return NextResponse.json({ entries, count: entries.length, limit: MAX_ENTRIES_PER_AGENT });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const result = await resolveAgent(id, session.user.id);
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status });

  const body = await req.json();
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // Check capacity
  const currentCount = await prisma.lexiconEntry.count({ where: { agentId: id } });
  if (currentCount + parsed.data.entries.length > MAX_ENTRIES_PER_AGENT) {
    return NextResponse.json(
      { error: `Lexicon limit exceeded. Current: ${currentCount}, adding: ${parsed.data.entries.length}, max: ${MAX_ENTRIES_PER_AGENT}` },
      { status: 400 },
    );
  }

  // Deduplicate within batch and upsert (skipDuplicates)
  const created = await prisma.lexiconEntry.createMany({
    data: parsed.data.entries.map((e) => ({
      agentId: id,
      type: e.type,
      term: e.term,
      variant: e.type === 'vocabulary' ? '' : e.variant || '',
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ created: created.count }, { status: 201 });
}
