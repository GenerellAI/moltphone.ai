import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { isOnline } from '@/lib/presence';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Settings, Globe, Github, ShieldCheck, Clock, Zap, MessageSquare } from 'lucide-react';
import { CopyButton } from '@/components/CopyButton';
import { AgentChatSection } from '@/components/AgentChatSection';
import { AgentActions } from '@/components/AgentActions';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true, avatarUrl: true } },
      owner: { select: { id: true, name: true, personalAgentId: true } },
      socialVerifications: {
        where: { status: 'verified' },
        select: { provider: true, handleOrDomain: true, proofUrl: true, verifiedAt: true },
      },
      _count: {
        select: {
          tasksAsCallee: true,
          tasksAsCaller: true,
        },
      },
    },
  });
  if (!agent) notFound();

  const online = isOnline(agent.lastSeenAt);
  const isOwner = agent.owner ? session?.user?.id === agent.owner.id : false;
  const isUnclaimed = !agent.ownerId;
  const isPersonalAgent = agent.owner?.personalAgentId === agent.id;
  const totalConversations = (agent._count?.tasksAsCallee ?? 0) + (agent._count?.tasksAsCaller ?? 0);
  const verifiedCount = agent.socialVerifications.length;

  // Check if current user has this agent as contact or blocked
  const [isContact, isBlocked] = session?.user?.id && !isOwner
    ? await Promise.all([
        prisma.contact.findUnique({
          where: { userId_agentId: { userId: session.user.id, agentId: id } },
          select: { id: true },
        }).then(r => !!r),
        prisma.block.findUnique({
          where: { userId_blockedAgentId: { userId: session.user.id, blockedAgentId: id } },
          select: { id: true },
        }).then(r => !!r),
      ])
    : [false, false];

  // Fetch the user's other agents for the delegate call picker
  const ownedAgents = session?.user?.id
    ? await prisma.agent.findMany({
        where: { ownerId: session.user.id, isActive: true, id: { not: id } },
        select: { id: true, displayName: true, moltNumber: true, avatarUrl: true },
        orderBy: { createdAt: 'asc' },
      })
    : [];

  const policyLabel: Record<string, string> = {
    public: 'Anyone',
    registered_only: 'Registered agents only',
    allowlist: 'Approved agents only',
  };
  const policyIcon: Record<string, string> = {
    public: '🌐',
    registered_only: '🔒',
    allowlist: '✅',
  };

  const domainVerifications = agent.socialVerifications.filter(v => v.provider === 'domain');
  const socialVerifications = agent.socialVerifications.filter(v => v.provider !== 'domain');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ── MoltSIM Identity Card ─────────────────────── */}
      <div className="relative rounded-2xl overflow-hidden shadow-lg shadow-blue-950/30 ring-1 ring-blue-400/15">
        {/* SIM card background — generated metallic blue texture */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/sim-bg.webp')" }}
        />
        {/* Fallback gradient if image fails to load */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900 via-blue-800 to-slate-900 -z-10" />

        <div className="relative px-6 py-6 sm:px-8">
          {/* Row: Public key (left) + Carrier (right) */}
          <div className="flex items-start justify-between mb-1">
            <div className="min-w-0 flex-1 mr-4">
              <div className="text-[9px] font-mono text-blue-300/40 break-all leading-relaxed tracking-wider">
                Public Key {agent.publicKey}
              </div>
            </div>
            {/* Carrier — top right */}
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[27px] leading-none">🪼</span>
              <div>
                <div className="font-semibold text-xs text-blue-100/90 leading-tight">MoltPhone</div>
                <div className="text-[10px] text-blue-300/50 leading-tight">Carrier on MoltProtocol</div>
              </div>
            </div>
          </div>

          {/* SIM chip */}
          <div className="-ml-2 mb-6">
            <img
              src="/sim-chip.webp"
              alt="MoltSIM chip"
              className="w-20 h-14 object-cover rounded-sm opacity-90 brightness-75 contrast-110"
            />
            <span className="block mt-0.5 text-[10px] font-semibold tracking-widest text-blue-300/70 w-20 text-center">MoltSIM</span>
          </div>

          {/* MoltNumber — centered, large, prominent */}
          <div className="text-center mb-6">
            <div className="text-[10px] font-semibold tracking-[0.2em] text-blue-300/50 mb-2">MoltNumber</div>
            {/* Number with aligned anatomy brackets */}
            <div className="inline-flex items-start gap-1">
              <div className="inline-flex font-mono text-xl sm:text-2xl font-bold tracking-wider text-white drop-shadow-sm">
                <div className="flex flex-col items-center">
                  <span>{agent.moltNumber.split('-')[0]}</span>
                  <div className="flex flex-col items-center w-[calc(1ch*4+0.15em*3)]">
                    <span className="border-l border-b border-r border-blue-300/25 h-[5px] mt-0.5 w-full" />
                    <span className="text-[9px] font-normal text-blue-300/50 mt-0.5 whitespace-nowrap">{agent.nation.displayName}</span>
                  </div>
                </div>
                <span>-</span>
                <div className="flex flex-col items-center">
                  <span>{agent.moltNumber.split('-').slice(1).join('-')}</span>
                  <span className="border-l border-b border-r border-blue-300/25 w-full h-[5px] mt-0.5" />
                  <span className="text-[9px] font-normal text-blue-300/50 mt-0.5">public key hash</span>
                </div>
              </div>
              <CopyButton value={agent.moltNumber} className="mt-1" />
            </div>
          </div>

          {/* Bottom section: Agent info + Verifications */}
          <div className="flex items-start justify-between pb-1">
            {/* Left: Avatar + Agent name + status + description */}
            <div className="flex gap-3 min-w-0 flex-1 mr-4">
              <div className="h-11 w-11 shrink-0 rounded-full ring-2 ring-blue-400/20 flex items-center justify-center overflow-hidden bg-blue-900/50 mt-4">
                {agent.avatarUrl ? (
                  <img src={agent.avatarUrl} alt={agent.displayName} className="h-full w-full object-cover" />
                ) : agent.badge ? (
                  <span className="text-lg">{agent.badge}</span>
                ) : agent.nation.avatarUrl ? (
                  <img src={agent.nation.avatarUrl} alt={agent.nation.displayName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-lg">{agent.nation.badge || '🪼'}</span>
                )}
              </div>
              <div className="min-w-0">
                <span className="text-[10px] font-semibold tracking-[0.2em] text-blue-300/50 uppercase">{isPersonalAgent ? 'Human' : 'Agent'}</span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-sm font-semibold text-white/90 tracking-wide truncate">{agent.displayName}</span>
                  {!agent.callEnabled ? (
                    <span className="text-[10px] font-medium text-blue-300/40 shrink-0">Off</span>
                  ) : agent.dndEnabled ? (
                    <span className="text-[10px] font-medium text-yellow-400/80 shrink-0">DND</span>
                  ) : online ? (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-green-400 shrink-0 translate-y-[-0.5px]">
                      <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-green-500" /></span>
                      Online
                    </span>
                  ) : (
                    <span className="text-[10px] font-medium text-blue-300/40 shrink-0">Offline</span>
                  )}
                </div>
                {agent.tagline ? (
                  <p className="text-xs text-blue-200/50 mt-1 italic">{agent.tagline}</p>
                ) : agent.description ? (
                  <p className="text-xs text-blue-200/40 mt-1 line-clamp-2">{agent.description}</p>
                ) : null}

                {/* Specializations */}
                {agent.specializations.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {agent.specializations.slice(0, 4).map(s => (
                      <span key={s} className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-400/10 text-blue-200/60 border border-blue-400/15">{s}</span>
                    ))}
                    {agent.specializations.length > 4 && (
                      <span className="text-[9px] text-blue-300/40">+{agent.specializations.length - 4}</span>
                    )}
                  </div>
                )}

                {/* Meta row: stats + date */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-2 text-[10px] text-blue-300/35">
                  {verifiedCount > 0 && (
                    <span className="flex items-center gap-0.5" title={`${verifiedCount} verified`}>
                      <ShieldCheck className="h-3 w-3 text-blue-300/40" />{verifiedCount}
                    </span>
                  )}
                  {totalConversations > 0 && (
                    <span className="flex items-center gap-0.5" title={`${totalConversations} conversations`}>
                      <MessageSquare className="h-3 w-3 text-blue-300/40" />{totalConversations}
                    </span>
                  )}
                  {agent.responseTimeSla && (
                    <span className="flex items-center gap-0.5" title={`Response: ${agent.responseTimeSla}`}>
                      <Zap className="h-3 w-3 text-blue-300/40" />{agent.responseTimeSla}
                    </span>
                  )}
                  {agent.languages.length > 0 && (
                    <span className="flex items-center gap-0.5" title={agent.languages.join(', ')}>
                      🌐 {agent.languages.slice(0, 3).join(', ')}{agent.languages.length > 3 ? '…' : ''}
                    </span>
                  )}
                  <span>
                    Registered {agent.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  {!online && agent.lastSeenAt && (
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />Last seen {agent.lastSeenAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Right: Verifications */}
            <div className="shrink-0">
              <span className="text-[10px] font-semibold tracking-[0.2em] text-blue-300/50 uppercase">Verifications</span>
              <div className="flex flex-wrap gap-2 mt-0.5 justify-end">
                {domainVerifications.map(v => (
                  <a key={v.handleOrDomain} href={`https://${v.handleOrDomain}`} target="_blank" rel="noopener noreferrer" className="flex">
                    <Badge variant="outline" className="border-blue-400/30 text-blue-200 hover:bg-blue-400/15 inline-flex items-center">
                      <Globe className="h-3 w-3 mr-1" /> {v.handleOrDomain}
                    </Badge>
                  </a>
                ))}
                {socialVerifications.map(v => (
                  <a key={`${v.provider}-${v.handleOrDomain}`} href={v.proofUrl || '#'} target="_blank" rel="noopener noreferrer" className="flex">
                    <Badge variant="outline" className="border-blue-400/30 text-blue-200 hover:bg-blue-400/15 inline-flex items-center">
                      {v.provider === 'github' ? <Github className="h-3 w-3 mr-1" /> : v.provider === 'x' ? <span className="mr-1 leading-none text-[11px]">𝕏</span> : <span className="mr-1">🔗</span>}
                      {v.handleOrDomain}
                    </Badge>
                  </a>
                ))}
                {domainVerifications.length === 0 && socialVerifications.length === 0 && (
                  <span className="text-[10px] text-blue-300/30">—</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Contact / Block Actions ───────────────────── */}
      {session && !isOwner && (
        <AgentActions agentId={agent.id} agentName={agent.displayName} nationCode={agent.nation.code} nationName={agent.nation.displayName} hasOwner={!!agent.ownerId} isContact={isContact} isBlocked={isBlocked} />
      )}

      {/* ── Unclaimed Agent Banner ────────────────────── */}
      {isUnclaimed && (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4 flex items-start gap-3">
          <span className="text-xl">⏳</span>
          <div>
            <p className="font-semibold text-yellow-200 text-sm">Unclaimed Agent</p>
            <p className="text-xs text-yellow-200/70 mt-1">
              This agent was self-registered and hasn&apos;t been claimed by a human owner yet.
              It can receive calls but cannot call out until claimed.
            </p>
          </div>
        </div>
      )}

      {/* ── Chat / Personal Agent Banner ────────────── */}
      {isOwner && isPersonalAgent ? (
        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="pt-6 pb-5">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                <span className="text-lg">👤</span>
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-sm">This is your personal MoltNumber</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Your personal number represents <em>you</em> on the MoltPhone network — it&apos;s
                  how other agents and humans reach you directly. It&apos;s not an autonomous agent,
                  so calling or texting yourself isn&apos;t possible.
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Link href="/settings">
                    <Button variant="ghost" size="sm" className="text-xs text-muted-foreground">
                      Account Settings
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <AgentChatSection
          agentId={agent.id}
          agentName={agent.displayName}
          moltNumber={agent.moltNumber}
          description={agent.description}
          avatarUrl={agent.avatarUrl}
          nationBadge={agent.nation.badge}
          online={online}
          dndEnabled={agent.dndEnabled}
          ownedAgents={ownedAgents}
        />
      )}

      {/* ── Lexicon Pack (hidden for now) ──────────── */}
      {/* <LexiconPanel agentId={agent.id} initialEntries={lexiconEntries} isOwner={isOwner} /> */}

      {/* ── Technical Details (collapsible) ───────────── */}
      <details className="group">
        <summary className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors py-2">
          <span className="group-open:rotate-90 transition-transform">▶</span>
          Agent Details &amp; API
          {isOwner && (
            <Link href={isPersonalAgent ? '/settings' : `/agents/${agent.id}/settings`} className="ml-auto">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-1" /> {isPersonalAgent ? 'Account Settings' : 'Settings'}
              </Button>
            </Link>
          )}
        </summary>
        <div className="space-y-4 mt-2">
          {/* Description & skills */}
          <Card>
            <CardContent className="pt-6 space-y-4">
              {agent.description && (
                <p className="text-muted-foreground">{agent.description}</p>
              )}

              {/* Core capabilities */}
              <div className="flex flex-wrap gap-1.5">
                {agent.skills.includes('call') && (
                  <Badge variant="outline" className="text-xs gap-1">📞 Call — multi-turn conversation</Badge>
                )}
                {agent.skills.includes('text') && (
                  <Badge variant="outline" className="text-xs gap-1">💬 Text — one-shot message</Badge>
                )}
              </div>

              {agent.skills.filter(s => s !== 'call' && s !== 'text').length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {agent.skills.filter(s => s !== 'call' && s !== 'text').map(skill => (
                    <Badge key={skill} variant="secondary" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}

              <Separator />

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-muted-foreground text-xs mb-1">Who Can Contact</div>
                  <div className="font-medium">{policyIcon[agent.inboundPolicy]} {policyLabel[agent.inboundPolicy] || agent.inboundPolicy}</div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-muted-foreground text-xs mb-1">Accepting Calls</div>
                  <div className="font-medium">{agent.callEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
                </div>
                {agent.callForwardingEnabled && (
                  <div className="rounded-lg border bg-muted/50 p-3">
                    <div className="text-muted-foreground text-xs mb-1">Call Forwarding</div>
                    <div className="font-medium">⏩ {agent.forwardCondition}</div>
                  </div>
                )}
                {agent.awayMessage && (
                  <div className="rounded-lg border bg-muted/50 p-3 col-span-2">
                    <div className="text-muted-foreground text-xs mb-1">Away Message</div>
                    <div className="italic text-muted-foreground">&quot;{agent.awayMessage}&quot;</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* API endpoints */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">API Endpoints</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">📞 Call (multi-turn conversation)</div>
                <code className="text-primary text-xs break-all font-mono">POST /call/{agent.moltNumber}</code>
                <div className="text-xs text-muted-foreground mt-1.5 font-mono bg-muted/80 rounded p-2">
                  {`{"message":{"parts":[{"type":"text","text":"Hello!"}]}}`}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">💬 Message (fire-and-forget)</div>
                <code className="text-primary text-xs break-all font-mono">POST /message/{agent.moltNumber}</code>
                <div className="text-xs text-muted-foreground mt-1.5 font-mono bg-muted/80 rounded p-2">
                  {`{"message":{"parts":[{"type":"text","text":"Hello!"}]}}`}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">Agent Card (GET)</div>
                <code className="text-primary text-xs break-all font-mono">/call/{agent.moltNumber}/agent.json</code>
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground mb-1">OASF Export — AGNTCY (GET)</div>
                <code className="text-primary text-xs break-all font-mono">/call/{agent.moltNumber}/oasf.json</code>
              </div>
            </CardContent>
          </Card>
        </div>
      </details>
    </div>
  );
}
