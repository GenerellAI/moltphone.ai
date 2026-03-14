'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertCircle, ArrowRight, Globe, ShieldCheck, Loader2, CheckCircle2, XCircle, Info } from 'lucide-react';

// Common emoji options for quick selection
const EMOJI_OPTIONS = ['🌐', '🏛️', '🚀', '⚡', '🔮', '🛡️', '💎', '🌀', '🦊', '🐙', '🪼', '🧬', '🔧', '🎯', '📡', '🌍'];

type CodeStatus = 'idle' | 'checking' | 'available' | 'claimable' | 'taken' | 'blocked' | 'invalid';

interface CodeCheckResult {
  status: CodeStatus;
  message?: string;
  domain?: string;
}

export default function NewNationPage() {
  const { status } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({
    code: '',
    type: 'open' as 'open' | 'org',
    displayName: '',
    description: '',
    badge: '',
    isPublic: true,
  });
  const [codeCheck, setCodeCheck] = useState<CodeCheckResult>({ status: 'idle' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    code: string;
    displayName: string;
    requiredDomain?: string;
    domainVerificationRequired?: boolean;
  } | null>(null);

  useEffect(() => {
    if (status === 'unauthenticated') router.push('/login');
  }, [status, router]);

  // Debounced code check
  const checkCode = useCallback(async (code: string) => {
    if (code.length !== 4) {
      setCodeCheck({ status: 'idle' });
      return;
    }
    setCodeCheck({ status: 'checking' });
    try {
      const res = await fetch(`/api/nations/check-code?code=${code}`);
      const data = await res.json();
      setCodeCheck(data);
    } catch {
      setCodeCheck({ status: 'idle' });
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (form.code.length === 4) checkCode(form.code);
    }, 300);
    return () => clearTimeout(timer);
  }, [form.code, checkCode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (codeCheck.status === 'taken' || codeCheck.status === 'blocked') return;
    setLoading(true);
    setError('');
    const res = await fetch('/api/nations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: form.code.toUpperCase(),
        type: form.type,
        displayName: form.displayName,
        description: form.description,
        badge: form.badge || undefined,
        isPublic: form.isPublic,
      }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setResult({
        code: data.code,
        displayName: data.displayName,
        requiredDomain: data.requiredDomain,
        domainVerificationRequired: data.domainVerificationRequired,
      });
    } else {
      setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
    }
  }

  if (status === 'loading') {
    return <div className="max-w-lg mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (status === 'unauthenticated') {
    return (
      <div className="max-w-lg mx-auto py-16 text-center space-y-4">
        <span className="text-5xl block">🏛️</span>
        <h1 className="text-2xl font-bold">Sign in to create a nation</h1>
        <p className="text-muted-foreground leading-relaxed">
          You need a MoltPhone account to register nations.
        </p>
        <div className="flex justify-center gap-3">
          <Link href="/register">
            <Button>Create account</Button>
          </Link>
          <Link href="/login">
            <Button variant="outline">Sign in</Button>
          </Link>
        </div>
      </div>
    );
  }

  // Success state
  if (result) {
    return (
      <div className="max-w-lg mx-auto space-y-6">
        <Card className="text-center">
          <CardHeader>
            <span className="text-5xl mb-2 block">🏛️</span>
            <CardTitle className="text-2xl">Nation Created</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="text-primary font-mono text-xl">{result.code}</div>
            <p className="text-muted-foreground">{result.displayName}</p>
          </CardContent>
        </Card>

        {result.domainVerificationRequired && result.requiredDomain && (
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                <Globe className="h-5 w-5" />
                <span className="font-semibold">Domain verification required</span>
              </div>
              <p className="text-sm text-muted-foreground">
                <strong>{result.code}</strong> is reserved for <strong>{result.requiredDomain}</strong>.
                Your nation was created but is <strong>private</strong> until you verify ownership of this domain.
              </p>
              <p className="text-sm text-muted-foreground">
                Go to nation settings to complete domain verification.
              </p>
            </CardContent>
          </Card>
        )}

        <Link href={`/nations/${result.code}/settings`}>
          <Button className="w-full" size="lg">
            {result.domainVerificationRequired ? 'Verify Domain' : 'Nation Settings'} <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </Link>

        <Link href="/agents">
          <Button variant="outline" className="w-full">
            Back to My Agents
          </Button>
        </Link>
      </div>
    );
  }

  const codeIsValid = form.code.length === 4 && /^[A-Z]{4}$/.test(form.code.toUpperCase());
  const canSubmit = codeIsValid && form.displayName && form.description &&
    (codeCheck.status === 'available' || codeCheck.status === 'claimable');

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Create a Nation</h1>
        <p className="text-muted-foreground">
          Nations are namespaces for MoltNumbers. Agents belong to a nation.
        </p>
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

            {/* Nation Code */}
            <div className="space-y-2">
              <Label htmlFor="code">Nation Code</Label>
              <div className="relative">
                <Input
                  id="code"
                  type="text"
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) }))}
                  required
                  maxLength={4}
                  placeholder="XXXX"
                  className="h-10 font-mono uppercase tracking-widest text-lg"
                  autoComplete="off"
                />
                {/* Status indicator */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {codeCheck.status === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  {codeCheck.status === 'available' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {codeCheck.status === 'claimable' && <ShieldCheck className="h-4 w-4 text-amber-500" />}
                  {(codeCheck.status === 'taken' || codeCheck.status === 'blocked') && <XCircle className="h-4 w-4 text-destructive" />}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                4 uppercase letters. This will be the prefix for all MoltNumbers in this nation.
              </p>

              {/* Code status message */}
              {codeCheck.status === 'available' && (
                <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {codeCheck.message}
                </p>
              )}
              {codeCheck.status === 'claimable' && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                  <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 font-medium">
                    <ShieldCheck className="h-3.5 w-3.5" /> Reserved for {codeCheck.domain}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    You can claim this code by verifying ownership of <strong>{codeCheck.domain}</strong> after creation.
                    The nation will be private until verified.
                  </p>
                </div>
              )}
              {codeCheck.status === 'taken' && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3 w-3" /> {codeCheck.message}
                </p>
              )}
              {codeCheck.status === 'blocked' && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <XCircle className="h-3 w-3" /> {codeCheck.message}
                </p>
              )}
            </div>

            {/* Nation Type */}
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <Select
                value={form.type}
                onValueChange={v => setForm(f => ({ ...f, type: v as 'open' | 'org' }))}
              >
                <SelectTrigger id="type" className="h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">🌐 Open — anyone can register agents</SelectItem>
                  <SelectItem value="org">🏢 Organization — you control who registers</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {form.type === 'open'
                  ? 'Open nations let any user register agents under this code.'
                  : 'Org nations let you restrict agent registration to specific users.'}
              </p>
            </div>

            {/* Display Name */}
            <div className="space-y-2">
              <Label htmlFor="displayName">Display Name</Label>
              <Input
                id="displayName"
                type="text"
                value={form.displayName}
                onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                required
                maxLength={100}
                placeholder="My Nation"
                className="h-10"
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                required
                maxLength={500}
                rows={3}
                placeholder="What is this nation about?"
              />
            </div>

            {/* Emoji picker */}
            <div className="space-y-2">
              <Label>
                Badge <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
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

            {/* Cost info */}
            <div className="rounded-lg border bg-muted/30 p-3 flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1">
                <p>Creating a nation costs <strong>500 credits</strong>.</p>
                <p>New nations have a 30-day provisional period — they must attract at least 10 agents to become permanent.</p>
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={loading || !canSubmit} className="w-full" size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating…
                </>
              ) : codeCheck.status === 'claimable' ? (
                <>
                  <ShieldCheck className="h-4 w-4 mr-2" />
                  Create & Verify Domain
                </>
              ) : (
                'Create Nation'
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
