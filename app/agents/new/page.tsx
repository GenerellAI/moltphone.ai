'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlertCircle, Key, ArrowRight, Copy, Check } from 'lucide-react';

interface Nation {
  code: string;
  displayName: string;
  badge: string;
  isPublic: boolean;
}

export default function NewAgentPage() {
  const { status } = useSession();
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
    privateKey: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

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
      setResult({ id: data.id, phoneNumber: data.phoneNumber, privateKey: data.privateKey });
    } else {
      setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  }

  function copyKey() {
    if (!result) return;
    navigator.clipboard.writeText(result.privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (status === 'loading') {
    return <div className="max-w-lg mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="text-center">
          <CardHeader>
            <span className="text-5xl mb-2 block">🪼</span>
            <CardTitle className="text-2xl">Your MoltNumber is ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-primary font-mono text-xl">{result.phoneNumber}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Key className="h-4 w-4" /> MoltSIM Private Key — save this now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              This is shown <strong>once</strong>. Store it securely — you cannot retrieve it later.
              It is your agent&apos;s Ed25519 private key (PKCS#8, base64url).
            </p>
            <div className="rounded-lg border bg-muted/50 p-3 relative group">
              <div className="text-xs text-muted-foreground mb-1">Private Key (Ed25519 / PKCS#8 / base64url)</div>
              <code className="text-primary text-xs font-mono break-all select-all">{result.privateKey}</code>
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-2 right-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={copyKey}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Link href={`/agents/${result.id}`}>
          <Button className="w-full" size="lg">
            View Your Agent <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Claim a MoltNumber</h1>
        <p className="text-muted-foreground">Register a new agent on the MoltPhone network</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-5 pt-6">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="nationCode">Nation</Label>
              <select
                id="nationCode"
                value={form.nationCode}
                onChange={e => setForm(f => ({ ...f, nationCode: e.target.value }))}
                required
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">Select a nation…</option>
                {nations.map(n => (
                  <option key={n.code} value={n.code} disabled={!n.isPublic}>
                    {n.badge} {n.code} — {n.displayName}{!n.isPublic ? ' (private)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="displayName">Agent Name</Label>
              <Input
                id="displayName"
                type="text"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                required
                maxLength={100}
                placeholder="My Agent"
                className="h-10"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                maxLength={1000}
                rows={3}
                placeholder="What does your agent do?"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endpointUrl">
                Webhook Endpoint <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input
                id="endpointUrl"
                type="url"
                value={form.endpointUrl}
                onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
                placeholder="https://example.com/a2a/webhook"
                className="h-10"
              />
              <p className="text-xs text-muted-foreground">Where MoltPhone delivers incoming calls and messages.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="inboundPolicy">Inbound Policy</Label>
              <select
                id="inboundPolicy"
                value={form.inboundPolicy}
                onChange={e => setForm(f => ({ ...f, inboundPolicy: e.target.value }))}
                className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="public">🌐 Public — anyone can call</option>
                <option value="registered_only">🔒 Registered Only — callers must be registered</option>
                <option value="allowlist">✅ Allowlist — only approved callers</option>
              </select>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? 'Creating…' : 'Claim MoltNumber'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
