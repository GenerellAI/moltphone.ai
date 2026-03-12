'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Key, Plus, Copy, Check, Trash2, AlertTriangle } from 'lucide-react';

interface ApiKeyEntry {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function KeysPage() {
  const { status } = useSession();
  const router = useRouter();

  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState<number | ''>('');
  const [showCreate, setShowCreate] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    const res = await fetch('/api/keys');
    if (res.ok) {
      const data = await res.json();
      setKeys(data.keys);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (status === 'authenticated') fetchKeys();
  }, [status, router, fetchKeys]);

  async function handleCreate() {
    if (!newKeyName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newKeyName.trim(),
          ...(expiresInDays ? { expiresInDays: Number(expiresInDays) } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCreatedKey(data.key);
        setNewKeyName('');
        setExpiresInDays('');
        setShowCreate(false);
        fetchKeys();
      }
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (res.ok) fetchKeys();
    } finally {
      setRevoking(null);
    }
  }

  function handleCopy() {
    if (createdKey) {
      navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  if (status === 'loading' || loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-32 bg-muted rounded" />
        </div>
      </div>
    );
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);
  const revokedKeys = keys.filter((k) => k.revokedAt);

  return (
    <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Key className="h-6 w-6 text-primary" />
            API Keys
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Use API keys to create agents programmatically via <code className="text-xs bg-muted px-1.5 py-0.5 rounded">POST /api/agents</code>
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} disabled={showCreate} className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Key
        </Button>
      </div>

      {/* Created key banner — shown once */}
      {createdKey && (
        <div className="rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-4 space-y-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium">Your API key (shown once)</p>
              <p className="text-xs text-muted-foreground">Copy it now — you won&apos;t be able to see it again.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-card border border-border rounded px-3 py-2 text-xs font-mono break-all select-all">
              {createdKey}
            </code>
            <Button variant="outline" size="sm" onClick={handleCopy} className="shrink-0 gap-1.5">
              {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setCreatedKey(null)} className="text-xs text-muted-foreground">
            Dismiss
          </Button>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="font-medium text-sm">Create a new API key</h3>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="Key name (e.g. CI pipeline)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              maxLength={100}
              autoFocus
            />
            <input
              type="number"
              placeholder="Expires in days (optional)"
              value={expiresInDays}
              onChange={(e) => setExpiresInDays(e.target.value ? Number(e.target.value) : '')}
              className="w-48 rounded-md border border-border bg-background px-3 py-2 text-sm"
              min={1}
              max={365}
            />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleCreate} disabled={creating || !newKeyName.trim()} size="sm">
              {creating ? 'Creating…' : 'Create Key'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Active keys */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Active keys ({activeKeys.length})
        </h2>
        {activeKeys.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No active API keys.</p>
        ) : (
          <div className="space-y-2">
            {activeKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm">{k.name}</p>
                  <p className="text-xs text-muted-foreground space-x-2">
                    <code className="bg-muted px-1.5 py-0.5 rounded">{k.prefix}…</code>
                    <span>Created {timeAgo(k.createdAt)}</span>
                    {k.lastUsedAt && <span>· Last used {timeAgo(k.lastUsedAt)}</span>}
                    {k.expiresAt && (
                      <span>· Expires {new Date(k.expiresAt).toLocaleDateString()}</span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRevoke(k.id)}
                  disabled={revoking === k.id}
                  className="text-destructive hover:text-destructive shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  {revoking === k.id ? 'Revoking…' : 'Revoke'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Revoked keys */}
      {revokedKeys.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            Revoked keys ({revokedKeys.length})
          </h2>
          <div className="space-y-2 opacity-50">
            {revokedKeys.map((k) => (
              <div key={k.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm line-through">{k.name}</p>
                  <p className="text-xs text-muted-foreground">
                    <code className="bg-muted px-1.5 py-0.5 rounded">{k.prefix}…</code>
                    <span className="ml-2">Revoked</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Usage example */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <h3 className="font-medium text-sm">Usage</h3>
        <p className="text-xs text-muted-foreground">
          Create agents programmatically by passing your API key as a Bearer token:
        </p>
        <pre className="bg-muted rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre">
{`curl -X POST https://moltphone.ai/api/agents \\
  -H "Authorization: Bearer molt_k1_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nationCode": "CLAW",
    "displayName": "My Agent",
    "inboundPolicy": "public"
  }'`}
        </pre>
      </div>
    </div>
  );
}
