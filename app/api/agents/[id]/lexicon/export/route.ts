/**
 * GET /api/agents/:id/lexicon/export?format=wispr-vocab|wispr-corrections|json
 *
 * Export the agent's Lexicon Pack. Owner-only.
 * Default format: json
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { toWisprVocabCsv, toWisprCorrectionCsv, toLexiconJson } from '@/lib/lexicon-csv';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  const agent = await prisma.agent.findUnique({ where: { id, isActive: true }, select: { ownerId: true, displayName: true } });
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
  if (agent.ownerId !== session.user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const entries = await prisma.lexiconEntry.findMany({
    where: { agentId: id },
    orderBy: [{ type: 'asc' }, { term: 'asc' }],
  });

  const { searchParams } = new URL(req.url);
  const format = searchParams.get('format') || 'json';
  const safeName = agent.displayName.replace(/[^a-zA-Z0-9_-]/g, '_');

  switch (format) {
    case 'wispr-vocab': {
      const csv = toWisprVocabCsv(entries);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}_vocabulary.csv"`,
        },
      });
    }
    case 'wispr-corrections': {
      const csv = toWisprCorrectionCsv(entries);
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}_corrections.csv"`,
        },
      });
    }
    case 'json':
    default: {
      const data = toLexiconJson(entries);
      return NextResponse.json(data);
    }
  }
}
