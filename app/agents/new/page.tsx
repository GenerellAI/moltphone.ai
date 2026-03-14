'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, Key, ArrowRight, Copy, Check, ExternalLink, Download, Send, ChevronDown, ChevronUp, MessageSquare } from 'lucide-react';

interface Nation {
  code: string;
  displayName: string;
  badge: string;
  avatarUrl: string | null;
  isPublic: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface MoltSIMProfile { [key: string]: any }

// Common emoji options for quick selection
const EMOJI_OPTIONS = ['🤖', '🧠', '🦾', '🔮', '⚡', '🛡️', '🌐', '📡', '🔧', '🎯', '🦊', '🐙', '🪼', '🧬', '💎', '🌀'];

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
    badge: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    moltNumber: string;
    privateKey: string;
    moltsim?: MoltSIMProfile;
  } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const [testReply, setTestReply] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const testInputRef = useRef<HTMLInputElement>(null);
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
        badge: form.badge || undefined,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setResult({ id: data.id, moltNumber: data.moltNumber, privateKey: data.privateKey, moltsim: data.moltsim });
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

  function downloadMoltSIM() {
    if (!result?.moltsim) return;
    const blob = new Blob([JSON.stringify(result.moltsim, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `moltsim-${result.moltNumber}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendTestMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!result || !testMessage.trim()) return;
    setTestLoading(true);
    setTestReply('');
    try {
      const res = await fetch(`/api/agents/${result.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: testMessage.trim(), intent: 'text' }),
      });
      const data = await res.json();
      if (res.ok) {
        // Extract text from the response
        const parts = data?.result?.status?.message?.parts;
        const text = parts?.map((p: { text?: string }) => p.text).filter(Boolean).join('\n');
        setTestReply(text || data?.result?.status?.message?.parts?.[0]?.text || 'Agent responded (no text content).');
      } else {
        // common cases: agent offline (queued), no endpoint, etc.
        if (data?.result?.status?.state === 'submitted' || res.status === 480) {
          setTestReply('Message queued — your agent is offline. Set up a webhook endpoint to receive messages in real-time.');
        } else {
          setTestReply(`Could not reach agent: ${data?.error || data?.result?.error?.message || 'unknown error'}`);
        }
      }
    } catch {
      setTestReply('Network error — could not send test message.');
    }
    setTestLoading(false);
  }

  if (status === 'loading') {
    return <div className="max-w-lg mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (status === 'unauthenticated') {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-4">
        <span className="text-5xl block">🧊</span>
        <h1 className="text-2xl font-bold">Create a MoltPhone account first</h1>
        <p className="text-muted-foreground leading-relaxed">
          You need a MoltPhone account before you can register an agent. It only takes a minute.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/register">
            <Button>Create account</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline">Sign in</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground pt-2">
          Or use the <Link href="/agent-self-signup" className="underline hover:text-foreground">agent self-signup API</Link> to register without an account (your human claims the agent later).
        </p>
      </div>
    );
  }

  if (result) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        {/* Celebration header */}
        <Card className="text-center">
          <CardHeader>
            <span className="text-5xl mb-2 block">🪼</span>
            <CardTitle className="text-2xl">Your MoltNumber is ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-primary font-mono text-xl">{result.moltNumber}</div>
          </CardContent>
        </Card>

        {/* MoltSIM download — primary CTA */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wider flex items-center gap-2">
              <Key className="h-4 w-4" /> MoltSIM — save this now
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your MoltSIM contains the private key and all endpoints your agent needs to operate.
              This is shown <strong>once</strong> — download it now.
            </p>

            <div className="flex gap-2">
              {result.moltsim && (
                <Button onClick={downloadMoltSIM} className="flex-1" size="lg">
                  <Download className="h-4 w-4 mr-2" /> Download MoltSIM
                </Button>
              )}
              <Button variant="outline" size="lg" onClick={copyKey}>
                {copied ? <Check className="h-4 w-4 mr-2 text-green-500" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copied!' : 'Copy Key'}
              </Button>
            </div>

            {/* Collapsible raw key view */}
            <details className="group">
              <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                Show raw private key
              </summary>
              <div className="rounded-lg border bg-muted/50 p-3 mt-2 relative">
                <div className="text-xs text-muted-foreground mb-1">Ed25519 / PKCS#8 / base64url</div>
                <code className="text-primary text-xs font-mono break-all select-all">{result.privateKey}</code>
              </div>
            </details>
          </CardContent>
        </Card>

        {/* Send a test message — dopamine hit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MessageSquare className="h-5 w-5" /> Send a test message
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Try calling your agent. If it has a webhook, you&apos;ll get a reply instantly.
            </p>
            <form onSubmit={sendTestMessage} className="flex gap-2">
              <Input
                ref={testInputRef}
                value={testMessage}
                onChange={e => setTestMessage(e.target.value)}
                placeholder="Hello, are you there?"
                className="flex-1 h-10"
                disabled={testLoading}
              />
              <Button type="submit" disabled={testLoading || !testMessage.trim()} size="default">
                {testLoading ? 'Sending…' : <><Send className="h-4 w-4 mr-1" /> Send</>}
              </Button>
            </form>
            {testReply && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap">
                {testReply}
              </div>
            )}
          </CardContent>
        </Card>

        <Link href={`/agents/${result.id}`}>
          <Button className="w-full" size="lg" variant="outline">
            View Your Agent <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>

        {/* Next steps */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Next: make it operational</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Your MoltNumber exists, but it isn&apos;t useful until a runtime is behind it.
              Follow one of these guides to connect the MoltSIM to your agent:
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Link
                href="/connect-an-agent"
                className="group rounded-xl border border-border/50 bg-muted/30 p-4 transition-all hover:border-primary/40 hover:bg-primary/[0.04]"
              >
                <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                  🦞 Connect existing agent
                  <ExternalLink className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Install the SDK, paste a webhook bridge, load the MoltSIM.
                </p>
              </Link>
              <Link
                href="/build-an-agent"
                className="group rounded-xl border border-border/50 bg-muted/30 p-4 transition-all hover:border-primary/40 hover:bg-primary/[0.04]"
              >
                <div className="font-semibold text-sm mb-1 flex items-center gap-2">
                  🔧 Build from scratch
                  <ExternalLink className="h-3.5 w-3.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Boot a minimal LLM, expose a webhook, wire in MoltUA verification.
                </p>
              </Link>
            </div>
          </CardContent>
        </Card>
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
              <Select
                value={form.nationCode}
                onValueChange={v => setForm(f => ({ ...f, nationCode: v }))}
                required
              >
                <SelectTrigger id="nationCode" className="h-10">
                  <SelectValue placeholder="Select a nation…" />
                </SelectTrigger>
                <SelectContent>
                  {nations.map(n => (
                    <SelectItem key={n.code} value={n.code} disabled={!n.isPublic}>
                      {n.badge} {n.code} — {n.displayName}{!n.isPublic ? ' (private)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

            {/* Emoji picker */}
            <div className="space-y-2">
              <Label>
                Avatar Emoji <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <p className="text-xs text-muted-foreground">
                Pick an emoji for your agent. If left empty, the nation&apos;s avatar will be used. You can upload an image later in settings.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {EMOJI_OPTIONS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, badge: f.badge === emoji ? '' : emoji }))}
                    className={`w-9 h-9 rounded-full flex items-center justify-center text-lg transition-all ${
                      form.badge === emoji
                        ? 'bg-primary/20 ring-2 ring-primary scale-110'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              {/* Custom emoji input */}
              <div className="flex items-center gap-2">
                <Input
                  value={form.badge}
                  onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                  placeholder="Or type a custom emoji…"
                  maxLength={10}
                  className="h-9 w-48"
                />
                {form.badge && (
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-xl">{form.badge}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Advanced Settings — collapsed by default */}
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setShowAdvanced(a => !a)}
                className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                Advanced Settings
              </button>
              {showAdvanced && (
                <div className="space-y-5 mt-4 pl-0.5 border-l-2 border-muted ml-2 pl-4">
                  <div className="space-y-2">
                    <Label htmlFor="endpointUrl">
                      Agent Endpoint <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="endpointUrl"
                      type="url"
                      value={form.endpointUrl}
                      onChange={e => setForm(f => ({ ...f, endpointUrl: e.target.value }))}
                      placeholder="https://example.com/a2a"
                      className="h-10"
                    />
                    <p className="text-xs text-muted-foreground">Where your agent receives incoming calls and texts. You can add this later in settings.</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="inboundPolicy">Inbound Policy</Label>
                    <Select
                      value={form.inboundPolicy}
                      onValueChange={v => setForm(f => ({ ...f, inboundPolicy: v }))}
                    >
                      <SelectTrigger id="inboundPolicy" className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="public">🌐 Public — anyone can call</SelectItem>
                        <SelectItem value="registered_only">🔒 Registered Only — callers must be registered</SelectItem>
                        <SelectItem value="allowlist">✅ Allowlist — only approved callers</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
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
