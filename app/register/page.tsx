'use client';
import { useState, useEffect, useRef } from 'react';
import { signIn, getProviders, type ClientSafeProvider } from 'next-auth/react';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { UserPlus, AlertCircle, Mail, Github } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const PROVIDER_META: Record<string, { label: string; icon: React.ReactNode }> = {
  google:  { label: 'Google',    icon: 'G' },
  github:  { label: 'GitHub',    icon: <Github className="h-4 w-4" /> },
  twitter: { label: 'X (Twitter)', icon: '𝕏' },
};

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [registered, setRegistered] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<ClientSafeProvider[]>([]);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const { theme } = useTheme();

  // Fetch available OAuth providers
  useEffect(() => {
    getProviders().then((providers) => {
      if (providers) {
        setOauthProviders(
          Object.values(providers).filter((p) => p.id !== 'credentials'),
        );
      }
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, turnstileToken: turnstileToken || '' }),
    });
    const data = await res.json();
    setLoading(false);
    if (res.ok) {
      setRegistered(true);
    } else {
      setError(data.error || 'Registration failed');
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    }
  }

  // Show "check your email" screen after successful registration
  if (registered) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="text-center mb-8">
          <Mail className="h-12 w-12 mx-auto mb-3 text-primary" />
          <h1 className="text-2xl font-bold text-primary">Check Your Email</h1>
          <p className="text-muted-foreground mt-2">
            We sent a verification link to <strong>{form.email}</strong>.
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            Click the link to activate your free MoltNumber.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Mail className="h-5 w-5" />
              <span>Didn&apos;t get the email?</span>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await fetch('/api/auth/resend-verification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ email: form.email }),
                });
                setError('');
              }}
            >
              Resend Verification Email
            </Button>
          </CardContent>
          <CardFooter className="justify-center text-sm text-muted-foreground">
            <Link href="/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🪼</div>
        <h1 className="text-2xl font-bold text-primary">Join MoltPhone</h1>
        <p className="text-muted-foreground mt-1">Register your account</p>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader className="pb-4">
            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {error}
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {oauthProviders.length > 0 && (
              <>
                <div className="flex flex-col gap-2">
                  {oauthProviders.map((provider) => {
                    const meta = PROVIDER_META[provider.id] || { label: provider.name, icon: '→' };
                    return (
                      <Button
                        key={provider.id}
                        type="button"
                        variant="outline"
                        className="w-full h-10"
                        onClick={() => signIn(provider.id, { callbackUrl: '/' })}
                      >
                        <span className="mr-2 font-bold text-base">{meta.icon}</span>
                        Sign up with {meta.label}
                      </Button>
                    );
                  })}
                </div>
                <div className="relative">
                  <Separator />
                  <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                    or
                  </span>
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="name">Name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="name"
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Your name"
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                placeholder="you@example.com"
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={8}
                placeholder="Min 8 characters"
                className="h-10"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {TURNSTILE_SITE_KEY && (
              <div className="w-full h-[65px] overflow-hidden">
                <Turnstile
                  ref={turnstileRef}
                  siteKey={TURNSTILE_SITE_KEY}
                  onSuccess={setTurnstileToken}
                  onExpire={() => setTurnstileToken(null)}
                  options={{ size: 'flexible', theme: theme }}
                  className="[&>iframe]:!w-full [&>iframe]:!h-full"
                />
              </div>
            )}
            <Button
              type="submit"
              disabled={loading || (!!TURNSTILE_SITE_KEY && !turnstileToken)}
              className="w-full h-10"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              {loading ? 'Wait...' : 'Register'}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:underline">Sign in</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
