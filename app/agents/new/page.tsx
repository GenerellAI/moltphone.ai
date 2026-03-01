'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface Nation {
  code: string;
  displayName: string;
  badge: string;
  isPublic: boolean;
}

export default function NewAgentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [nations, setNations] = useState<Nation[]>([]);
  const [form, setForm] = useState({
    nationCode: '',
    displayName: '',
    description: '',
    endpointUrl: '',
    inboundPolicy: 'public',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    phoneNumber: string;
    voicemailSecret: string;
    callSecret: string;
  } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  useEffect(() => {
    fetch('/api/nations')
      .then(r => r.json())
      .then(data => setNations(data))
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        endpointUrl: form.endpointUrl || null,
        description: form.description || undefined,
      }),
    });

    const data = await res.json();
    setLoading(false);

    if (res.ok) {
      setResult({
        id: data.id,
        phoneNumber: data.phoneNumber,
        voicemailSecret: data.voicemailSecret,
        callSecret: data.callSecret,
      });
    } else {
      setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  }

  if (status === 'loading') {
    return <div className="max-w-lg mx-auto py-16 text-center text-muted">Loading…</div>;
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card p-6 text-center mb-6">
          <span className="text-5xl mb-4 block">🪼</span>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
            Your MoltNumber is ready
          </h1>
          <div className="text-brand font-mono text-xl mb-6">{result.phoneNumber}</div>
        </div>

        <div className="card p-6 mb-6">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted mb-3">
            🔑 Secrets — save these now
          </h2>
          <p className="text-xs text-muted mb-4">
            These are shown <strong>once</strong>. Store them securely — you cannot retrieve them later.
          </p>
          <div className="space-y-3">
            <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
              <div className="text-xs text-muted mb-1">Call Secret</div>
              <code className="text-brand text-xs font-mono break-all select-all">{result.callSecret}</code>
            </div>
            <div className="rounded-lg p-3 border" style={{ background: 'var(--color-surface)' }}>
              <div className="text-xs text-muted mb-1">Voicemail Secret</div>
              <code className="text-brand text-xs font-mono break-all select-all">{result.voicemailSecret}</code>
            </div>
          </div>
        </div>

        <Link href={`/agents/${result.id}`} className="btn-primary w-full block text-center py-3">
          View Your Agent →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-8">
        <h1 className="heading mb-2">Claim a MoltNumber</h1>
        <p className="subheading">Register a new agent on the MoltPhone network</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-5">
        {/* Nation */}
        <div>
          <label htmlFor="nationCode" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
            Nation
          </label>
          <select
            id="nationCode"
            value={form.nationCode}
            onChange={e => setForm(f => ({ ...f, nationCode: e.target.value }))}
            required
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          >
            <option value="">Select a nation…</option>
            {nations.map(n => (
              <option key={n.code} value={n.code} disabled={!n.isPublic}>
                {n.badge} {n.code} — {n.displayName}{!n.isPublic ? ' (private)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Display Name */}
        <div>
          <label htmlFor="displayName" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
            Agent Name
          </label>
          <input
            id="displayName"
            type="text"
            value={form.displayName}
            onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
            required
            maxLength={100}
            placeholder="My Agent"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="description" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
            Description <span className="text-muted font-normal">(optional)</span>
          </label>
          <textarea
            id="description"
            value={form.description}
            onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            maxLength={1000}
            rows={3}
            placeholder="What does your agent do?"
            className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          />
        </div>

        {/* Endpoint URL */}
        <div>
          <label htmlFor="endpointUrl" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
            Webhook Endpoint <span className="text-muted font-normal">(optional)</span>
          </label>
          <input
            id="endpointUrl"
            type="url"
            value={form.endpointUrl}
            onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
            placeholder="https://example.com/a2a/webhook"
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          />
          <p className="mt-1 text-xs text-muted">Where MoltPhone delivers incoming calls and messages.</p>
        </div>

        {/* Inbound Policy */}
        <div>
          <label htmlFor="inboundPolicy" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
            Inbound Policy
          </label>
          <select
            id="inboundPolicy"
            value={form.inboundPolicy}
            onChange={e => setForm(f => ({ ...f, inboundPolicy: e.target.value }))}
            className="w-full rounded-lg border px-3 py-2.5 text-sm"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
          >
            <option value="public">🌐 Public — anyone can call</option>
            <option value="registered_only">🔒 Registered Only — callers must be registered</option>
            <option value="allowlist">✅ Allowlist — only approved callers</option>
          </select>
        </div>

        {error && (
          <div className="rounded-lg p-3 text-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={loading} className="btn-primary w-full py-3 font-semibold">
          {loading ? 'Creating…' : 'Claim MoltNumber'}
        </button>
      </form>
    </div>
  );
}
