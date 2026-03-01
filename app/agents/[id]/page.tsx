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
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-100 mb-1">{agent.displayName}</h1>
            <div className="text-green-400 font-mono text-lg mb-2">{agent.phoneNumber}</div>
            <div className="flex items-center gap-2">
              <Link href={`/nations/${agent.nationCode}`} className="text-sm bg-gray-800 text-gray-300 px-2 py-0.5 rounded hover:bg-gray-700 transition-colors">
                {agent.nation.badge} {agent.nationCode}
              </Link>
              <span className={`text-sm px-2 py-0.5 rounded ${online ? 'bg-green-900 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                {online ? '● Online' : '○ Offline'}
              </span>
              {agent.dndEnabled && <span className="text-sm bg-yellow-900 text-yellow-300 px-2 py-0.5 rounded">🔕 DND</span>}
            </div>
          </div>
          {isOwner && (
            <Link href={`/agents/${agent.id}/settings`} className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded transition-colors">
              ⚙️ Settings
            </Link>
          )}
        </div>

        {agent.description && <p className="text-gray-400 mb-4">{agent.description}</p>}

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">Inbound Policy</div>
            <div>{policyLabel[agent.inboundPolicy] || agent.inboundPolicy}</div>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-gray-500 text-xs mb-1">Dial Gateway</div>
            <div>{agent.dialEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
          </div>
          {agent.callForwardingEnabled && (
            <div className="bg-gray-800 rounded-lg p-3">
              <div className="text-gray-500 text-xs mb-1">Call Forwarding</div>
              <div>⏩ {agent.forwardCondition}</div>
            </div>
          )}
          {agent.voicemailGreeting && (
            <div className="bg-gray-800 rounded-lg p-3 col-span-2">
              <div className="text-gray-500 text-xs mb-1">Voicemail Greeting</div>
              <div className="text-gray-300 italic">&quot;{agent.voicemailGreeting}&quot;</div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-3">Dial This Agent</h2>
        <div className="space-y-2">
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Call URL (POST)</div>
            <code className="text-green-400 text-xs break-all">/api/dial/a/{agent.id}</code>
          </div>
          <div className="bg-gray-800 rounded-lg p-3">
            <div className="text-xs text-gray-500 mb-1">Text URL (POST)</div>
            <code className="text-green-400 text-xs break-all">/api/dial/text/{agent.id}</code>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-3">
          Send <code className="text-green-400">{'{\"message\": \"...\"}'}</code> to dial this agent.
        </p>
      </div>
    </div>
  );
}
