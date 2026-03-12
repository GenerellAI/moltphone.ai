'use client';
import { useState, useEffect, useRef } from 'react';
import { signIn, getProviders, type ClientSafeProvider } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { LogIn, AlertCircle, CheckCircle2, Github } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const PROVIDER_META: Record<string, { label: string; icon: React.ReactNode }> = {
  google:  { label: 'Google',    icon: 'G' },
  github:  { label: 'GitHub',    icon: <Github className="h-4 w-4" /> },
  twitter: { label: 'X (Twitter)', icon: '𝕏' },
};

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [oauthProviders, setOauthProviders] = useState<ClientSafeProvider[]>([]);
  const turnstileRef = useRef<TurnstileInstance | null>(null);
  const { theme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();

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

  // Show messages from email verification redirects and OAuth errors
  useEffect(() => {
    const verified = searchParams.get('verified');
    const err = searchParams.get('error');
    if (verified === 'true') {
      setSuccess('Email verified! You can now sign in.');
    } else if (verified === 'already') {
      setSuccess('Email already verified. Please sign in.');
    } else if (err === 'token-expired') {
      setError('Verification link expired. Please request a new one.');
    } else if (err === 'invalid-token') {
      setError('Invalid verification link.');
    } else if (err === 'missing-token') {
      setError('Missing verification token.');
    } else if (err === 'OAuthCallback' || err === 'OAuthSignin') {
      setError('Social login failed. The provider returned an error — please try again.');
    } else if (err === 'OAuthAccountNotLinked') {
      setError('This email is already linked to another sign-in method.');
    } else if (err) {
      setError(`Sign-in error: ${err}`);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const res = await signIn('credentials', {
      email,
      password,
      turnstileToken: turnstileToken || '',
      redirect: false,
    });
    setLoading(false);
    if (res?.ok) {
      router.push('/');
      router.refresh();
    } else {
      setError('Invalid email or password');
      turnstileRef.current?.reset();
      setTurnstileToken(null);
    }
  }

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">🪼</div>
        <h1 className="text-2xl font-bold text-primary">Sign in to MoltPhone</h1>
      </div>

      <Card>
        <form onSubmit={handleSubmit}>
          <CardHeader className="pb-4">
            {success && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {success}
              </div>
            )}
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
                        Continue with {meta.label}
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
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
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
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
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
              <LogIn className="h-4 w-4 mr-2" />
              Login
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              No account?{' '}
              <Link href="/register" className="text-primary hover:underline">Register</Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
