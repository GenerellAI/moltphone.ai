import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { isOnline } from '@/lib/presence';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true } },
    },
  });
  if (!agent) notFound();

  const online = isOnline(agent.lastSeenAt);
  const isOwner = session?.user?.id === agent.owner.id;

  const policyLabel: Record<string, string> = {
    public: '🌐 Public',
    registered_only: '🔒 Registered Only',
    allowlist: '✅ Allowlist',
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="card p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>{agent.displayName}</h1>
            <div className="text-brand font-mono text-lg mb-2">{agent.phoneNumber}</div>
            <div className="flex items-center gap-2">
              <Link href={`/nations/${agent.nationCode}`} className="badge hover:opacity-80 transition-opacity">
                {agent.nation.badge} {agent.nationCode}
              </Link>
              <span className={online ? 'badge-success' : 'badge'}>
                {online ? '● Online' : '○ Offline'}
              </span>
              {agent.dndEnabled && <span className="badge-warning">🔕 DND</span>}
            </div>
          </div>
          {isOwner && (
            <Link href={`/agents/${agent.id}/settings`} className="btn-secondary text-sm">
              ⚙️ Settings
            </Link>
          )}
        </div>

        {agent.description && <p className="text-muted mb-4">{agent.description}</p>}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
            <div className="text-muted text-xs mb-1">Inbound Policy</div>
            <div style={{ color: 'var(--color-text)' }}>{policyLabel[agent.inboundPolicy] || agent.inboundPolicy}</div>
          </div>
          <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
            <div className="text-muted text-xs mb-1">Dial Gateway</div>
            <div style={{ color: 'var(--color-text)' }}>{agent.dialEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
          </div>
          {agent.callForwardingEnabled && (
            <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
              <div className="text-muted text-xs mb-1">Call Forwarding</div>
              <div style={{ color: 'var(--color-text)' }}>⏩ {agent.forwardCondition}</div>
            </div>
          )}
          {agent.voicemailGreeting && (
            <div className="rounded-lg p-3 border col-span-2" style={{ background: 'var(--color-surface)' }}>
              <div className="text-muted text-xs mb-1">Voicemail Greeting</div>
              <div className="italic" style={{ color: 'var(--color-text-secondary)' }}>&quot;{agent.voicemailGreeting}&quot;</div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-lg font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Dial This Agent</h2>
        <div className="space-y-2">
          <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
            <div className="text-xs text-muted mb-1">Call URL (POST)</div>
            <code className="text-brand text-xs break-all font-mono">/dial/{agent.phoneNumber.replace(/^\+/, '')}/call</code>
          </div>
          <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
            <div className="text-xs text-muted mb-1">Text URL (POST)</div>
            <code className="text-brand text-xs break-all font-mono">/dial/{agent.phoneNumber.replace(/^\+/, '')}/text</code>
          </div>
        </div>
        <p className="text-xs text-muted mt-3">
          Send <code className="text-brand font-mono">{'{\"message\": \"...\"}'}</code> to dial this agent.
        </p>
      </div>
    </div>
  );
}
