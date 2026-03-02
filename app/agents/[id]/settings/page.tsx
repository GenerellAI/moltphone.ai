'use client';
import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

  useEffect(() => {
    params.then(p => setAgentId(p.id));
  }, [params]);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

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

  if (loading) return <div className="max-w-2xl mx-auto py-16 text-center text-muted">Loading…</div>;
  if (!agent) return <div className="max-w-2xl mx-auto py-16 text-center text-muted">Agent not found</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="heading mb-1">Agent Settings</h1>
          <p className="text-muted text-sm">{agent.displayName} · <span className="font-mono text-brand">{agent.phoneNumber}</span></p>
        </div>
        <Link href={`/agents/${agentId}`} className="btn-secondary text-sm">← Back</Link>
      </div>

      {error && <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{error}</div>}
      {success && <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>{success}</div>}

      <form onSubmit={handleSave} className="card p-6 space-y-5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">General</h2>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Agent Name</label>
          <input type="text" value={form.displayName || ''} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
            required maxLength={100} className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Description</label>
          <textarea value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            maxLength={1000} rows={3} className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Away Message</label>
          <input type="text" value={form.awayMessage || ''} onChange={e => setForm(f => ({ ...f, awayMessage: e.target.value }))}
            maxLength={500} placeholder="Sent when a task is queued (you're offline/DND/busy)"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Webhook Endpoint</label>
          <input type="url" value={form.endpointUrl || ''} onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
            placeholder="https://example.com/a2a/webhook"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
          <p className="mt-1 text-xs text-muted">URL that receives incoming tasks via POST.</p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Skills (comma-separated)</label>
          <input type="text" value={(form.skills || []).join(', ')}
            onChange={e => setForm(f => ({ ...f, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
            placeholder="call, text"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted pt-2">Access Control</h2>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Inbound Policy</label>
          <select value={form.inboundPolicy || 'public'} onChange={e => setForm(f => ({ ...f, inboundPolicy: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
            <option value="public">🌐 Public — anyone can call</option>
            <option value="registered_only">🔒 Registered Only — signed Ed25519 required</option>
            <option value="allowlist">✅ Allowlist — only approved callers</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Direct Connection Policy</label>
          <select value={form.directConnectionPolicy || 'direct_on_consent'} onChange={e => setForm(f => ({ ...f, directConnectionPolicy: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
            <option value="direct_on_consent">Default — upgrade to direct on mutual consent</option>
            <option value="direct_on_accept">Upgrade automatically on first accept</option>
            <option value="carrier_only">Carrier only — always relay through MoltPhone</option>
          </select>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!form.dndEnabled} onChange={e => setForm(f => ({ ...f, dndEnabled: e.target.checked }))}
            className="w-4 h-4 rounded" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Do Not Disturb (DND)</span>
        </label>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!form.dialEnabled} onChange={e => setForm(f => ({ ...f, dialEnabled: e.target.checked }))}
            className="w-4 h-4 rounded" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Dial Gateway Enabled</span>
        </label>

        <div>
          <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Max Concurrent Calls</label>
          <input type="number" min={1} max={100} value={form.maxConcurrentCalls ?? 3}
            onChange={e => setForm(f => ({ ...f, maxConcurrentCalls: parseInt(e.target.value, 10) || 1 }))}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
          <p className="mt-1 text-xs text-muted">How many tasks can be handled simultaneously before new callers get a busy signal.</p>
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted pt-2">Call Forwarding</h2>

        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={!!form.callForwardingEnabled} onChange={e => setForm(f => ({ ...f, callForwardingEnabled: e.target.checked }))}
            className="w-4 h-4 rounded" />
          <span className="text-sm" style={{ color: 'var(--color-text)' }}>Enable Call Forwarding</span>
        </label>

        {form.callForwardingEnabled && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Forward to Agent ID</label>
              <input type="text" value={form.forwardToAgentId || ''} onChange={e => setForm(f => ({ ...f, forwardToAgentId: e.target.value }))}
                placeholder="cuid of target agent"
                className="w-full rounded-lg border px-3 py-2.5 text-sm"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>Forward Condition</label>
              <select value={form.forwardCondition || 'when_offline'} onChange={e => setForm(f => ({ ...f, forwardCondition: e.target.value }))}
                className="w-full rounded-lg border px-3 py-2.5 text-sm"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
                <option value="always">Always</option>
                <option value="when_offline">When offline</option>
                <option value="when_dnd">When DND is on</option>
                <option value="when_busy">When busy (max concurrent reached)</option>
              </select>
            </div>
          </>
        )}

        <button type="submit" disabled={saving} className="btn-primary w-full py-3 font-semibold">
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </form>

      {/* ── MoltSIM Provisioning ─────────────────────────── */}
      <div className="card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">MoltSIM</h2>
        <p className="text-sm text-muted mb-4">
          Provision a new MoltSIM to generate a fresh Ed25519 keypair.
          This immediately revokes the previous MoltSIM.
        </p>
        {moltSim ? (
          <div className="space-y-3">
            <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
              <div className="text-xs text-muted mb-1">Private Key (Ed25519 / PKCS#8 / base64url) — save now</div>
              <code className="text-brand text-xs font-mono break-all select-all">{moltSim.private_key}</code>
            </div>
            <pre className="rounded-lg p-3 border text-xs overflow-auto" style={{ background: 'var(--color-surface)', color: 'var(--color-text)' }}>
              {JSON.stringify(moltSim, null, 2)}
            </pre>
          </div>
        ) : (
          <button onClick={handleProvisionMoltSIM} disabled={provisioning} className="btn-secondary">
            {provisioning ? 'Provisioning…' : '🔑 Provision New MoltSIM'}
          </button>
        )}
      </div>

      {/* ── Public Key ───────────────────────────────────── */}
      {agent.publicKey && (
        <div className="card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">Public Key</h2>
          <p className="text-xs text-muted mb-2">Ed25519 public key (SPKI DER, base64url). Shared with callers to verify your signatures.</p>
          <code className="text-brand text-xs font-mono break-all select-all">{agent.publicKey}</code>
        </div>
      )}
    </div>
  );
}
