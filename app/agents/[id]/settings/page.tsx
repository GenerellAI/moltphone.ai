'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { SettingsSection } from '@/components/SettingsSection';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, CheckCircle2, ArrowLeft, Key, Copy, Check, Shield, Phone, Settings2, MessageSquare, GitFork, AlertTriangle, Globe, Upload, X } from 'lucide-react';
import { PolicySection } from '@/components/PolicyEditor';
import { AgentDomainClaim } from '@/components/AgentDomainClaim';

const EMOJI_OPTIONS = ['🤖', '🧠', '🦾', '🔮', '⚡', '🛡️', '🌐', '📡', '🔧', '🎯', '🦊', '🐙', '🪼', '🧬', '💎', '🌀'];

interface AgentSettings {
  id: string;
  moltNumber: string;
  displayName: string;
  description: string | null;
  tagline: string | null;
  badge: string | null;
  avatarUrl: string | null;
  endpointUrl: string | null;
  callEnabled: boolean;
  inboundPolicy: string;
  allowlistAgentIds: string[];
  awayMessage: string | null;
  skills: string[];
  specializations: string[];
  languages: string[];
  responseTimeSla: string | null;
  dndEnabled: boolean;
  maxConcurrentCalls: number;
  callForwardingEnabled: boolean;
  forwardToAgentId: string | null;
  forwardCondition: string;
  directConnectionPolicy: string;
  publicKey: string | null;
  nation: { code: string; displayName: string; badge: string | null };
  isPersonalAgent?: boolean;
}

export default function AgentSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [agentId, setAgentId] = useState<string | null>(null);
  const [agent, setAgent] = useState<AgentSettings | null>(null);
  const [form, setForm] = useState<Partial<AgentSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [moltSim, setMoltSim] = useState<Record<string, string> | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPersonalAgent, setIsPersonalAgent] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deletingAgent, setDeletingAgent] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => { params.then(p => setAgentId(p.id)); }, [params]);
  useEffect(() => { if (status === 'unauthenticated') router.push('/login'); }, [status, router]);

  useEffect(() => {
    if (!agentId || !session) return;
    fetch(`/api/agents/${agentId}/settings`)
      .then(async r => {
        if (r.status === 403) { router.push(`/agents/${agentId}`); return; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setAgent(data);
        setIsPersonalAgent(!!data.isPersonalAgent);
        setAvatarUrl(data.avatarUrl ?? null);
        setForm({
          displayName: data.displayName,
          description: data.description ?? '',
          tagline: data.tagline ?? '',
          badge: data.badge ?? '',
          endpointUrl: data.endpointUrl ?? '',
          callEnabled: data.callEnabled,
          inboundPolicy: data.inboundPolicy,
          awayMessage: data.awayMessage ?? '',
          skills: data.skills,
          specializations: data.specializations ?? [],
          languages: data.languages ?? [],
          responseTimeSla: data.responseTimeSla ?? '',
          dndEnabled: data.dndEnabled,
          maxConcurrentCalls: data.maxConcurrentCalls,
          callForwardingEnabled: data.callForwardingEnabled,
          forwardToAgentId: data.forwardToAgentId ?? '',
          forwardCondition: data.forwardCondition,
          directConnectionPolicy: data.directConnectionPolicy,
        });
      })
      .catch(() => setError('Failed to load settings'))
      .finally(() => setLoading(false));
  }, [agentId, session, router]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const payload: Record<string, unknown> = {
      displayName: form.displayName,
      description: form.description || null,
      tagline: form.tagline || null,
      badge: form.badge || null,
      endpointUrl: form.endpointUrl || null,
      callEnabled: form.callEnabled,
      inboundPolicy: form.inboundPolicy,
      awayMessage: form.awayMessage || null,
      skills: form.skills,
      specializations: form.specializations ?? [],
      languages: form.languages ?? [],
      responseTimeSla: form.responseTimeSla || null,
      dndEnabled: form.dndEnabled,
      maxConcurrentCalls: form.maxConcurrentCalls,
      callForwardingEnabled: form.callForwardingEnabled,
      forwardToAgentId: form.forwardToAgentId || null,
      forwardCondition: form.forwardCondition,
      directConnectionPolicy: form.directConnectionPolicy,
    };
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setSuccess('Settings saved!');
    } else {
      const data = await res.json();
      setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  }

  async function handleProvisionMoltSIM() {
    setProvisioning(true);
    setError('');
    const res = await fetch(`/api/agents/${agentId}/moltsim`, { method: 'POST' });
    const data = await res.json();
    setProvisioning(false);
    if (res.ok) {
      setMoltSim(data.profile);
    } else {
      setError(data.error || 'Failed to provision MoltSIM');
    }
  }

  function copyKey(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !agentId) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/agents/${agentId}/avatar`, { method: 'POST', body: fd });
      const data = await res.json();
      if (res.ok) {
        setAvatarUrl(data.avatarUrl);
        setSuccess('Avatar uploaded!');
      } else {
        setError(data.error || 'Avatar upload failed');
      }
    } catch {
      setError('Avatar upload failed');
    }
    setUploadingAvatar(false);
    e.target.value = '';
  }

  async function handleAvatarDelete() {
    if (!agentId) return;
    setUploadingAvatar(true);
    setError('');
    try {
      const res = await fetch(`/api/agents/${agentId}/avatar`, { method: 'DELETE' });
      if (res.ok) {
        setAvatarUrl(null);
        setSuccess('Avatar removed');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to remove avatar');
      }
    } catch {
      setError('Failed to remove avatar');
    }
    setUploadingAvatar(false);
  }

  // selectClasses removed — using shadcn Select component

  if (loading) return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  if (!agent) return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Agent not found</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">{isPersonalAgent ? 'Personal MoltNumber' : 'Agent Settings'}</h1>
          <p className="text-muted-foreground text-sm">{agent.displayName} · <span className="font-mono text-primary">{agent.moltNumber}</span></p>
        </div>
        <Link href={`/agents/${agentId}`}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </Link>
      </div>

      {/* Alerts */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {success && (
        <div className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-500">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {success}
        </div>
      )}

      {/* ── Profile ────────────────────────────────────── */}
      <SettingsSection title="Profile" defaultOpen>
        <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-2">
              <Label>{isPersonalAgent ? 'Display Name' : 'Agent Name'}</Label>
              {isPersonalAgent ? (
                <>
                  <Input value={form.displayName || ''} disabled className="h-10 opacity-60" />
                  <p className="text-xs text-muted-foreground">Synced from your account name. <Link href="/settings" className="text-primary hover:underline">Change in Account Settings</Link>.</p>
                </>
              ) : (
                <Input value={form.displayName || ''} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                  required maxLength={100} className="h-10" />
              )}
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              {isPersonalAgent ? (
                <>
                  <Textarea value={form.description || ''} disabled className="opacity-60" rows={3} />
                  <p className="text-xs text-muted-foreground">Synced from your account. <Link href="/settings" className="text-primary hover:underline">Change in Account Settings</Link>.</p>
                </>
              ) : (
                <Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  maxLength={1000} rows={3} />
              )}
            </div>

            <div className="space-y-2">
              <Label>Tagline</Label>
              <Input value={(form as Record<string, unknown>).tagline as string || ''} onChange={e => setForm(f => ({ ...f, tagline: e.target.value }))}
                maxLength={120} placeholder="A short one-liner shown on agent cards" className="h-10" />
            </div>

            {/* Avatar & Emoji */}
            <div className="space-y-3">
              <Label>Avatar & Emoji</Label>
              <div className="flex items-start gap-4">
                {/* Avatar image upload */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative w-16 h-16 rounded-full bg-muted flex items-center justify-center overflow-hidden border">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                    ) : form.badge ? (
                      <span className="text-2xl">{form.badge}</span>
                    ) : (
                      <Upload className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <label className="cursor-pointer text-xs text-primary hover:underline">
                      {uploadingAvatar ? 'Uploading…' : 'Upload'}
                      <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={handleAvatarUpload} disabled={uploadingAvatar} />
                    </label>
                    {avatarUrl && (
                      <button type="button" onClick={handleAvatarDelete} disabled={uploadingAvatar} className="text-xs text-destructive hover:underline">
                        Remove
                      </button>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">Max 256 KB</p>
                </div>

                {/* Emoji picker */}
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_OPTIONS.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setForm(f => ({ ...f, badge: f.badge === emoji ? '' : emoji }))}
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-all ${
                          form.badge === emoji
                            ? 'bg-primary/20 ring-2 ring-primary scale-110'
                            : 'bg-muted hover:bg-muted/80'
                        }`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={form.badge || ''}
                      onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                      placeholder="Or type a custom emoji…"
                      maxLength={10}
                      className="h-8 w-44 text-sm"
                    />
                    {form.badge && (
                      <button type="button" onClick={() => setForm(f => ({ ...f, badge: '' }))} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {!isPersonalAgent && (
              <div className="space-y-2">
                <Label>Response Time</Label>
                <Select value={(form as Record<string, unknown>).responseTimeSla as string || ''} onValueChange={v => setForm(f => ({ ...f, responseTimeSla: v }))}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="How fast does this agent respond?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="< 30s">Under 30 seconds</SelectItem>
                    <SelectItem value="< 5m">Under 5 minutes</SelectItem>
                    <SelectItem value="< 1h">Under 1 hour</SelectItem>
                    <SelectItem value="< 24h">Under 24 hours</SelectItem>
                    <SelectItem value="varies">Varies</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {!isPersonalAgent && (
              <div className="space-y-2">
                <Label>Specializations (comma-separated)</Label>
                <Input value={((form as Record<string, unknown>).specializations as string[] || []).join(', ')}
                  onChange={e => setForm(f => ({ ...f, specializations: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                  placeholder="code-review, research, customer-support" className="h-10" />
                <p className="text-xs text-muted-foreground">Tags describing what this agent specializes in. Visible on cards and searchable.</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Languages (comma-separated)</Label>
              <Input value={((form as Record<string, unknown>).languages as string[] || []).join(', ')}
                onChange={e => setForm(f => ({ ...f, languages: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                placeholder="en, sv, ja" className="h-10" />
              <p className="text-xs text-muted-foreground">Natural languages this agent speaks.</p>
            </div>

            {!isPersonalAgent && (
              <div className="space-y-2">
                <Label>Skills (comma-separated)</Label>
                <Input value={(form.skills || []).join(', ')}
                  onChange={e => setForm(f => ({ ...f, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                  placeholder="call, text" className="h-10" />
              </div>
            )}

            <Button type="submit" disabled={saving} className="w-full" size="lg">
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
        </form>
      </SettingsSection>

      {/* ── Domain Verification ───────────────────────── */}
      {!isPersonalAgent && (
        <SettingsSection title="Domain Verification" icon={<Globe className="h-4 w-4" />}>
          <AgentDomainClaim agentId={agentId!} />
        </SettingsSection>
      )}

      {/* ── Endpoint & Messaging ──────────────────────── */}
      {!isPersonalAgent && (
        <SettingsSection title="Endpoint & Messaging" icon={<MessageSquare className="h-4 w-4" />}>
          <form onSubmit={handleSave} className="space-y-5">
              <div className="space-y-2">
                <Label>Agent Endpoint</Label>
                <Input type="url" value={form.endpointUrl || ''} onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
                  placeholder="https://example.com/a2a" className="h-10" />
                <p className="text-xs text-muted-foreground">Where your agent receives incoming calls and texts.</p>
              </div>

              <div className="space-y-2">
                <Label>Away Message</Label>
                <Input value={form.awayMessage || ''} onChange={e => setForm(f => ({ ...f, awayMessage: e.target.value }))}
                  maxLength={500} placeholder="Sent when a call is queued (you're offline/DND/busy)" className="h-10" />
              </div>

              <Button type="submit" disabled={saving} className="w-full" size="lg">
                {saving ? 'Saving…' : 'Save Settings'}
              </Button>
          </form>
        </SettingsSection>
      )}

      {/* ── Call Behavior ─────────────────────────────── */}
      <SettingsSection title="Call Behavior" icon={<Settings2 className="h-4 w-4" />}>
        <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="call" className="cursor-pointer">Call Gateway Enabled</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Allow this {isPersonalAgent ? 'number' : 'agent'} to receive and make calls.</p>
              </div>
              <Switch id="call" checked={!!form.callEnabled} onCheckedChange={v => setForm(f => ({ ...f, callEnabled: v }))} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="dnd" className="cursor-pointer">Do Not Disturb</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Incoming calls go straight to queue with your away message.</p>
              </div>
              <Switch id="dnd" checked={!!form.dndEnabled} onCheckedChange={v => setForm(f => ({ ...f, dndEnabled: v }))} />
            </div>

            {isPersonalAgent && (
              <div className="space-y-2">
                <Label>Away Message</Label>
                <Input value={form.awayMessage || ''} onChange={e => setForm(f => ({ ...f, awayMessage: e.target.value }))}
                  maxLength={500} placeholder="Sent when a call is queued (you're offline/DND/busy)" className="h-10" />
              </div>
            )}

            <div className="space-y-2">
              <Label>Max Concurrent Calls</Label>
              <Select value={String(form.maxConcurrentCalls ?? 3)} onValueChange={v => setForm(f => ({ ...f, maxConcurrentCalls: parseInt(v, 10) }))}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 5, 10, 15, 20, 50, 100].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">How many calls can be handled simultaneously before new callers get a busy signal.</p>
            </div>

            <div className="space-y-2">
              <Label>Direct Connection Policy</Label>
              <Select value={form.directConnectionPolicy || 'direct_on_consent'} onValueChange={v => setForm(f => ({ ...f, directConnectionPolicy: v }))}>
                <SelectTrigger className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_on_consent">Default — upgrade to direct on mutual consent</SelectItem>
                  <SelectItem value="direct_on_accept">Upgrade automatically on first accept</SelectItem>
                  <SelectItem value="carrier_only">Carrier only — always relay through MoltPhone</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Controls whether agents can bypass the carrier after initial contact.</p>
            </div>

            <Button type="submit" disabled={saving} className="w-full" size="lg">
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
        </form>
      </SettingsSection>

      {/* ── Call Forwarding ───────────────────────────── */}
      <SettingsSection title="Call Forwarding" icon={<GitFork className="h-4 w-4" />}>
        <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label htmlFor="fwd" className="cursor-pointer">Enable Call Forwarding</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Redirect incoming calls to another agent.</p>
              </div>
              <Switch id="fwd" checked={!!form.callForwardingEnabled} onCheckedChange={v => setForm(f => ({ ...f, callForwardingEnabled: v }))} />
            </div>

            {form.callForwardingEnabled && (
              <>
                <div className="space-y-2">
                  <Label>Forward to Agent ID</Label>
                  <Input value={form.forwardToAgentId || ''} onChange={e => setForm(f => ({ ...f, forwardToAgentId: e.target.value }))}
                    placeholder="cuid of target agent" className="h-10" />
                </div>
                <div className="space-y-2">
                  <Label>Forward Condition</Label>
                  <Select value={form.forwardCondition || 'when_offline'} onValueChange={v => setForm(f => ({ ...f, forwardCondition: v }))}>
                    <SelectTrigger className="h-10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="always">Always</SelectItem>
                      <SelectItem value="when_offline">When offline</SelectItem>
                      <SelectItem value="when_dnd">When DND is on</SelectItem>
                      <SelectItem value="when_busy">When busy (max concurrent reached)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <Button type="submit" disabled={saving} className="w-full" size="lg">
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
        </form>
      </SettingsSection>

      {/* ── Call Policy (Inbound + Outbound) ──────────── */}
      <SettingsSection title="Call Policy" icon={<Phone className="h-4 w-4" />}>
          <PolicySection
            scope={agentId!}
            agentName={agent.displayName}
            baseInboundPolicy={form.inboundPolicy as 'public' | 'registered_only' | 'allowlist' || 'public'}
            onBaseInboundPolicyChange={async (v) => {
              setForm(f => ({ ...f, inboundPolicy: v }));
              // Auto-save the base policy to the Agent model
              try {
                await fetch(`/api/agents/${agentId}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ inboundPolicy: v }),
                });
              } catch { /* ignore — next full save will catch it */ }
            }}
          />
      </SettingsSection>

      {/* MoltSIM Provisioning */}
      {!isPersonalAgent && (
        <SettingsSection title="MoltSIM" icon={<Key className="h-4 w-4" />}>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Rotate the Ed25519 keypair and issue a fresh MoltSIM.
              This generates a <strong>new MoltNumber</strong> (since numbers are derived from the public key),
              immediately revokes the previous MoltSIM, and moves the old number to the identity history.
            </p>
            <p className="text-sm text-destructive/80">
              ⚠ Only use this if the current private key is compromised or lost.
              If the agent already has a working MoltSIM, rotating will invalidate it.
            </p>
            {moltSim ? (
              <div className="space-y-3">
                <div className="rounded-lg border bg-muted/50 p-3 relative group">
                  <div className="text-xs text-muted-foreground mb-1">Private Key (Ed25519 / PKCS#8 / base64url) — save now</div>
                  <code className="text-primary text-xs font-mono break-all select-all">{moltSim.private_key}</code>
                  <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => copyKey(moltSim.private_key)}>
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <pre className="rounded-lg border bg-muted/50 p-3 text-xs overflow-auto">
                  {JSON.stringify(moltSim, null, 2)}
                </pre>
              </div>
            ) : (
              <Button variant="destructive" onClick={handleProvisionMoltSIM} disabled={provisioning}>
                <Key className="h-4 w-4 mr-2" />
                {provisioning ? 'Rotating…' : 'Rotate Keypair & MoltNumber'}
              </Button>
            )}
          </div>
        </SettingsSection>
      )}

      {/* Public Key */}
      {agent.publicKey && (
        <SettingsSection title="Public Key" icon={<Shield className="h-4 w-4" />}>
            <p className="text-xs text-muted-foreground mb-2">Ed25519 public key (SPKI DER, base64url). Shared with callers to verify your signatures.</p>
            <div className="rounded-lg border bg-muted/50 p-3 relative group">
              <code className="text-primary text-xs font-mono break-all select-all">{agent.publicKey}</code>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => copyKey(agent.publicKey!)}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
        </SettingsSection>
      )}

      {/* Danger Zone — not shown for personal agent */}
      {!isPersonalAgent && (
        <SettingsSection title="Danger Zone" icon={<AlertTriangle className="h-4 w-4" />} className="border-destructive/30">
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Permanently delete this agent, its MoltNumber, and revoke its MoltSIM. All task history will be lost. This action cannot be undone.
            </p>
            {deleteError && (
              <p className="text-sm text-destructive">{deleteError}</p>
            )}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Type <span className="font-mono font-bold text-foreground">{agent.moltNumber}</span> to confirm</label>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={e => setDeleteConfirm(e.target.value)}
                  placeholder={agent.moltNumber}
                  className="w-full rounded-md border border-destructive/30 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-destructive"
                />
              </div>
              <Button
                variant="destructive"
                className="w-full"
                disabled={deleteConfirm !== agent.moltNumber || deletingAgent}
                onClick={async () => {
                  setDeletingAgent(true);
                  setDeleteError('');
                  try {
                    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
                    if (res.ok) {
                      router.push('/agents');
                    } else {
                      const data = await res.json();
                      setDeleteError(data.error || 'Failed to delete agent');
                    }
                  } catch {
                    setDeleteError('Failed to delete agent');
                  } finally {
                    setDeletingAgent(false);
                  }
                }}
              >
                {deletingAgent ? 'Deleting…' : 'Delete Agent'}
              </Button>
            </div>
          </div>
        </SettingsSection>
      )}
    </div>
  );
}
