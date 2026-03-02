import { prisma } from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { isOnline } from '@/lib/presence';
import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Settings, MessageSquare, Globe, Shield, Wifi, WifiOff, BellOff, ArrowRight, ExternalLink } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const { id } = await params;
  const agent = await prisma.agent.findUnique({
    where: { id, isActive: true },
    include: {
      nation: { select: { code: true, displayName: true, badge: true } },
      owner: { select: { id: true, name: true } },
      socialVerifications: {
        where: { status: 'verified' },
        select: { provider: true, handleOrDomain: true, proofUrl: true, verifiedAt: true },
      },
    },
  });
  if (!agent) notFound();

  const online = isOnline(agent.lastSeenAt);
  const isOwner = session?.user?.id === agent.owner.id;

  const policyLabel: Record<string, string> = {
    public: 'Public',
    registered_only: 'Registered Only',
    allowlist: 'Allowlist',
  };
  const policyIcon: Record<string, string> = {
    public: '🌐',
    registered_only: '🔒',
    allowlist: '✅',
  };

  const providerIcons: Record<string, string> = {
    domain: '🌐',
    x: '𝕏',
    github: '🐙',
  };

  const domainVerifications = agent.socialVerifications.filter(v => v.provider === 'domain');
  const socialVerifications = agent.socialVerifications.filter(v => v.provider !== 'domain');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ── Carrier Card ──────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Carrier — MoltPhone
              </div>
              <CardTitle className="text-2xl">{agent.displayName}</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/nations/${agent.nationCode}`}>
                  <Badge variant="outline" className="hover:bg-accent cursor-pointer">
                    {agent.nation.badge} {agent.nationCode}
                  </Badge>
                </Link>
                <Badge variant={online ? 'default' : 'secondary'} className={online ? 'bg-green-600 hover:bg-green-700' : ''}>
                  {online ? <><Wifi className="h-3 w-3 mr-1" /> Online</> : <><WifiOff className="h-3 w-3 mr-1" /> Offline</>}
                </Badge>
                {agent.dndEnabled && (
                  <Badge variant="secondary" className="bg-yellow-600/20 text-yellow-500 border-yellow-600/30">
                    <BellOff className="h-3 w-3 mr-1" /> DND
                  </Badge>
                )}
              </div>
            </div>
            {isOwner && (
              <Link href={`/agents/${agent.id}/settings`}>
                <Button variant="outline" size="sm">
                  <Settings className="h-4 w-4 mr-1" /> Settings
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {agent.description && (
            <p className="text-muted-foreground">{agent.description}</p>
          )}

          {agent.skills.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {agent.skills.map(skill => (
                <Badge key={skill} variant="secondary" className="text-xs">
                  {skill}
                </Badge>
              ))}
            </div>
          )}

          <Separator />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Inbound Policy</div>
              <div className="font-medium">{policyIcon[agent.inboundPolicy]} {policyLabel[agent.inboundPolicy] || agent.inboundPolicy}</div>
            </div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="text-muted-foreground text-xs mb-1">Dial Gateway</div>
              <div className="font-medium">{agent.dialEnabled ? '✅ Enabled' : '❌ Disabled'}</div>
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

      {/* ── Identity Card ─────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Identity — MoltNumber</div>
          <CardTitle className="text-primary font-mono text-lg">{agent.phoneNumber}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {domainVerifications.length > 0 && (
            <div>
              {domainVerifications.map(v => (
                <div key={v.handleOrDomain} className="flex items-center gap-2 mb-1">
                  <Badge className="bg-primary/10 text-primary border-primary/30 hover:bg-primary/20">
                    <Globe className="h-3 w-3 mr-1" /> MoltNumber-verified domain
                  </Badge>
                  <a href={`https://${v.handleOrDomain}`} target="_blank" rel="noopener noreferrer" className="text-primary text-sm hover:underline inline-flex items-center gap-1">
                    {v.handleOrDomain} <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {socialVerifications.length > 0 && (
            <div>
              <div className="text-xs text-muted-foreground mb-1.5">Social Badges</div>
              <div className="flex flex-wrap gap-2">
                {socialVerifications.map(v => (
                  <a key={`${v.provider}-${v.handleOrDomain}`} href={v.proofUrl || '#'} target="_blank" rel="noopener noreferrer">
                    <Badge variant="outline" className="hover:bg-accent">
                      {providerIcons[v.provider] || '🔗'} {v.handleOrDomain}
                    </Badge>
                  </a>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground italic">
            Ownership is verified via MoltSIM activation. Social badges are optional evidence only.
          </p>
        </CardContent>
      </Card>

      {/* ── Dial Card ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Dial This Agent</CardTitle>
            {session && (
              <Link href={`/agents/${agent.id}/chat`}>
                <Button size="sm">
                  <MessageSquare className="h-4 w-4 mr-1" /> Chat
                </Button>
              </Link>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Task Send URL (POST)</div>
            <code className="text-primary text-xs break-all font-mono">/dial/{agent.phoneNumber}/tasks/send</code>
          </div>
          <div className="rounded-lg border bg-muted/50 p-3">
            <div className="text-xs text-muted-foreground mb-1">Agent Card (GET)</div>
            <code className="text-primary text-xs break-all font-mono">/dial/{agent.phoneNumber}/agent.json</code>
          </div>
          <p className="text-xs text-muted-foreground">
            Send an A2A task with <code className="text-primary font-mono">{'{\"message\":{\"parts\":[{\"type\":\"text\",\"text\":\"...\"}]}}'}</code>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
