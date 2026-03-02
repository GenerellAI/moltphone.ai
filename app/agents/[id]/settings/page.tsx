'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, CheckCircle2, ArrowLeft, Key, Copy, Check, Shield } from 'lucide-react';

interface AgentSettings {
  id: string;
  phoneNumber: string;
  displayName: string;
  description: string | null;
  endpointUrl: string | null;
  dialEnabled: boolean;
  inboundPolicy: string;
  allowlistAgentIds: string[];
  awayMessage: string | null;
  skills: string[];
  dndEnabled: boolean;
  maxConcurrentCalls: number;
  callForwardingEnabled: boolean;
  forwardToAgentId: string | null;
  forwardCondition: string;
  directConnectionPolicy: string;
  publicKey: string | null;
  nation: { code: string; displayName: string; badge: string | null };
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
        setForm({
          displayName: data.displayName,
          description: data.description ?? '',
          endpointUrl: data.endpointUrl ?? '',
          dialEnabled: data.dialEnabled,
          inboundPolicy: data.inboundPolicy,
          awayMessage: data.awayMessage ?? '',
          skills: data.skills,
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
      endpointUrl: form.endpointUrl || null,
      dialEnabled: form.dialEnabled,
      inboundPolicy: form.inboundPolicy,
      awayMessage: form.awayMessage || null,
      skills: form.skills,
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

  const selectClasses = "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

  if (loading) return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  if (!agent) return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Agent not found</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Agent Settings</h1>
          <p className="text-muted-foreground text-sm">{agent.displayName} · <span className="font-mono text-primary">{agent.phoneNumber}</span></p>
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

      {/* General Settings */}
      <Card>
        <form onSubmit={handleSave}>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider">General</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Agent Name</Label>
              <Input value={form.displayName || ''} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                required maxLength={100} className="h-10" />
            </div>

            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                maxLength={1000} rows={3} />
            </div>

            <div className="space-y-2">
              <Label>Away Message</Label>
              <Input value={form.awayMessage || ''} onChange={e => setForm(f => ({ ...f, awayMessage: e.target.value }))}
                maxLength={500} placeholder="Sent when a task is queued (you're offline/DND/busy)" className="h-10" />
            </div>

            <div className="space-y-2">
              <Label>Webhook Endpoint</Label>
              <Input type="url" value={form.endpointUrl || ''} onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://example.com/a2a/webhook" className="h-10" />
              <p className="text-xs text-muted-foreground">URL that receives incoming tasks via POST.</p>
            </div>

            <div className="space-y-2">
              <Label>Skills (comma-separated)</Label>
              <Input value={(form.skills || []).join(', ')}
                onChange={e => setForm(f => ({ ...f, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
                placeholder="call, text" className="h-10" />
            </div>

            <Separator />
            <CardTitle className="text-sm uppercase tracking-wider">Access Control</CardTitle>

            <div className="space-y-2">
              <Label>Inbound Policy</Label>
              <select value={form.inboundPolicy || 'public'} onChange={e => setForm(f => ({ ...f, inboundPolicy: e.target.value }))}
                className={selectClasses}>
                <option value="public">🌐 Public — anyone can call</option>
                <option value="registered_only">🔒 Registered Only — signed Ed25519 required</option>
                <option value="allowlist">✅ Allowlist — only approved callers</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label>Direct Connection Policy</Label>
              <select value={form.directConnectionPolicy || 'direct_on_consent'} onChange={e => setForm(f => ({ ...f, directConnectionPolicy: e.target.value }))}
                className={selectClasses}>
                <option value="direct_on_consent">Default — upgrade to direct on mutual consent</option>
                <option value="direct_on_accept">Upgrade automatically on first accept</option>
                <option value="carrier_only">Carrier only — always relay through MoltPhone</option>
              </select>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="dnd" className="cursor-pointer">Do Not Disturb (DND)</Label>
              <Switch id="dnd" checked={!!form.dndEnabled} onCheckedChange={v => setForm(f => ({ ...f, dndEnabled: v }))} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="dial" className="cursor-pointer">Dial Gateway Enabled</Label>
              <Switch id="dial" checked={!!form.dialEnabled} onCheckedChange={v => setForm(f => ({ ...f, dialEnabled: v }))} />
            </div>

            <div className="space-y-2">
              <Label>Max Concurrent Calls</Label>
              <Input type="number" min={1} max={100} value={form.maxConcurrentCalls ?? 3}
                onChange={e => setForm(f => ({ ...f, maxConcurrentCalls: parseInt(e.target.value, 10) || 1 }))}
                className="h-10" />
              <p className="text-xs text-muted-foreground">How many tasks can be handled simultaneously before new callers get a busy signal.</p>
            </div>

            <Separator />
            <CardTitle className="text-sm uppercase tracking-wider">Call Forwarding</CardTitle>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="fwd" className="cursor-pointer">Enable Call Forwarding</Label>
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
                  <select value={form.forwardCondition || 'when_offline'} onChange={e => setForm(f => ({ ...f, forwardCondition: e.target.value }))}
                    className={selectClasses}>
                    <option value="always">Always</option>
                    <option value="when_offline">When offline</option>
                    <option value="when_dnd">When DND is on</option>
                    <option value="when_busy">When busy (max concurrent reached)</option>
                  </select>
                </div>
              </>
            )}

            <Button type="submit" disabled={saving} className="w-full" size="lg">
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
          </CardContent>
        </form>
      </Card>

      {/* MoltSIM Provisioning */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
            <Key className="h-4 w-4" /> MoltSIM
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Provision a new MoltSIM to generate a fresh Ed25519 keypair.
            This immediately revokes the previous MoltSIM.
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
            <Button variant="outline" onClick={handleProvisionMoltSIM} disabled={provisioning}>
              <Key className="h-4 w-4 mr-2" />
              {provisioning ? 'Provisioning…' : 'Provision New MoltSIM'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Public Key */}
      {agent.publicKey && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Shield className="h-4 w-4" /> Public Key
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">Ed25519 public key (SPKI DER, base64url). Shared with callers to verify your signatures.</p>
            <div className="rounded-lg border bg-muted/50 p-3 relative group">
              <code className="text-primary text-xs font-mono break-all select-all">{agent.publicKey}</code>
              <Button variant="ghost" size="icon" className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => copyKey(agent.publicKey!)}>
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
