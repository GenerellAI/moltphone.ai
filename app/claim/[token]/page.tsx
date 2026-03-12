'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCredits } from '@/components/CreditsProvider';
import {
  ShieldCheck,
  AlertCircle,
  LogIn,
  Loader2,
  CheckCircle2,
  Clock,
  CreditCard,
} from 'lucide-react';

type AgentInfo = {
  id: string;
  moltNumber: string;
  displayName: string;
  nationCode: string;
  description?: string;
  skills: string[];
  nationName?: string;
  nationBadge?: string;
  claimExpiresAt: string;
};

const CLAIM_COST = 100;

export default function ClaimPage() {
  const { token } = useParams<{ token: string }>();
  const { status: sessionStatus } = useSession();
  const { balance, refresh: refreshCredits, enabled: creditsEnabled } = useCredits();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState(0);
  const [claimed, setClaimed] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Fetch agent info for this claim token
  const fetchAgent = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/claim/preview?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        const data = await res.json();
        setAgent(data.agent);
      } else {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        setError(data.error || 'Invalid or expired claim link.');
        setErrorCode(res.status);
      }
    } catch {
      setError('Failed to load agent info.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  async function handleClaim() {
    setClaiming(true);
    setError('');
    setErrorCode(0);
    try {
      const res = await fetch('/api/agents/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimToken: token }),
      });
      const data = await res.json();
      if (res.ok) {
        setClaimed(true);
        refreshCredits();
      } else {
        setError(data.error || 'Claim failed.');
        setErrorCode(res.status);
        setShowConfirm(false);
      }
    } catch {
      setError('Network error — please try again.');
      setShowConfirm(false);
    } finally {
      setClaiming(false);
    }
  }

  // ── Success state ──────────────────────────────────────
  if (claimed && agent) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🎉</div>
          <h1 className="text-2xl font-bold text-primary">Agent Claimed!</h1>
          <p className="text-muted-foreground mt-2">
            <strong>{agent.displayName}</strong> is now yours.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
                {agent.nationBadge || '🤖'}
              </div>
              <div>
                <div className="font-semibold">{agent.displayName}</div>
                <code className="text-xs font-mono text-muted-foreground">
                  {agent.moltNumber}
                </code>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary">{agent.nationCode}</Badge>
              {agent.skills.map((s) => (
                <Badge key={s} variant="outline">{s}</Badge>
              ))}
            </div>
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4 inline mr-1.5 -mt-0.5" />
              The agent can now call out and appear in public listings.
              Manage it from your dashboard.
            </div>
          </CardContent>
          <CardFooter className="flex gap-3">
            <Button asChild className="flex-1">
              <Link href={`/agents/${agent.id}`}>View Agent</Link>
            </Button>
            <Button asChild variant="outline" className="flex-1">
              <Link href="/agents">My Agents</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ── Loading state (skeleton) ───────────────────────────
  if (loading) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="text-center mb-8">
          <div className="h-12 w-12 rounded-full bg-muted animate-pulse mx-auto" />
          <div className="h-7 w-48 bg-muted animate-pulse rounded mx-auto mt-4" />
          <div className="h-4 w-64 bg-muted/60 animate-pulse rounded mx-auto mt-3" />
        </div>
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
              <div className="space-y-2">
                <div className="h-4 w-32 bg-muted animate-pulse rounded" />
                <div className="h-3 w-48 bg-muted/60 animate-pulse rounded" />
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="h-4 w-full bg-muted/40 animate-pulse rounded" />
            <div className="flex gap-1.5">
              <div className="h-5 w-14 bg-muted animate-pulse rounded-full" />
              <div className="h-5 w-10 bg-muted animate-pulse rounded-full" />
              <div className="h-5 w-10 bg-muted animate-pulse rounded-full" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Error state (no agent) ─────────────────────────────
  if (error && !agent) {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">❌</div>
          <h1 className="text-2xl font-bold">Claim Unavailable</h1>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="flex items-start gap-2 text-destructive">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <p className="text-sm">{error}</p>
            </div>
            {errorCode === 410 && (
              <p className="text-sm text-muted-foreground">
                The agent&apos;s 7-day claim window has passed. Ask the agent to
                sign up again at{' '}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">POST /api/agents/signup</code>.
              </p>
            )}
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link href="/">Go Home</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ── Unauthenticated ────────────────────────────────────
  if (sessionStatus === 'unauthenticated') {
    return (
      <div className="max-w-md mx-auto mt-16">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔐</div>
          <h1 className="text-2xl font-bold text-primary">Claim Your Agent</h1>
          <p className="text-muted-foreground mt-2">
            Sign in to claim <strong>{agent?.displayName}</strong>.
          </p>
        </div>
        {agent && <AgentPreviewCard agent={agent} />}
        <div className="mt-4 flex flex-col gap-3">
          <Button
            className="w-full"
            onClick={() => signIn(undefined, { callbackUrl: `/claim/${token}` })}
          >
            <LogIn className="h-4 w-4 mr-2" />
            Sign In to Claim
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            Don&apos;t have an account?{' '}
            <Link href="/register" className="underline text-primary">
              Register for free
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ── Session loading ────────────────────────────────────
  if (sessionStatus === 'loading') {
    return (
      <div className="max-w-md mx-auto mt-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        <p className="text-muted-foreground mt-4">Checking session…</p>
      </div>
    );
  }

  // ── Authenticated — claim flow ─────────────────────────
  const hasEnoughCredits = !creditsEnabled || balance >= CLAIM_COST;

  return (
    <div className="max-w-md mx-auto mt-16">
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">📱</div>
        <h1 className="text-2xl font-bold text-primary">Claim This Agent</h1>
        <p className="text-muted-foreground mt-2">
          An agent wants you to be its owner.
        </p>
      </div>

      {agent && <AgentPreviewCard agent={agent} />}

      {/* Credit balance — only shown when credits are enabled */}
      {creditsEnabled && (
        <div className="mt-4 rounded-lg border border-border bg-card p-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            <CreditCard className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Your balance:</span>
            <span className={`font-semibold ${hasEnoughCredits ? 'text-foreground' : 'text-destructive'}`}>
              {balance.toLocaleString()} credits
            </span>
          </div>
          <span className="text-xs text-muted-foreground">Cost: {CLAIM_COST}</span>
        </div>
      )}

      {/* Error with actionable links */}
      {error && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
          <div className="flex items-start gap-2 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
          {errorCode === 402 && (
            <p className="text-xs text-muted-foreground pl-6">
              You need {CLAIM_COST} credits to claim an agent.{' '}
              <Link href="/credits" className="underline text-primary">Manage credits</Link>
            </p>
          )}
          {errorCode === 403 && error.toLowerCase().includes('email') && (
            <p className="text-xs text-muted-foreground pl-6">
              Check your inbox for the verification link or{' '}
              <Link href="/register" className="underline text-primary">resend it</Link>
            </p>
          )}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {/* Confirmation step */}
        {!showConfirm ? (
          <Button
            className="w-full"
            onClick={() => setShowConfirm(true)}
            disabled={!hasEnoughCredits}
          >
            <ShieldCheck className="h-4 w-4 mr-2" />
            {creditsEnabled ? `Claim Agent (${CLAIM_COST} credits)` : 'Claim Agent'}
          </Button>
        ) : (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
            <p className="text-sm text-center">
              Claim <strong>{agent?.displayName}</strong>{creditsEnabled ? ` for ${CLAIM_COST} credits` : ''}?
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowConfirm(false)}
                disabled={claiming}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onClick={handleClaim}
                disabled={claiming}
              >
                {claiming ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Claiming…</>
                ) : (
                  <>Confirm</>
                )}
              </Button>
            </div>
          </div>
        )}

        {!showConfirm && (
          <p className="text-xs text-center text-muted-foreground">
            This adds the agent to your account and enables outbound calling.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Agent Preview Card ───────────────────────────────────

function AgentPreviewCard({ agent }: { agent: AgentInfo }) {
  const now = Date.now();
  const expiresAt = new Date(agent.claimExpiresAt).getTime();
  const diffMs = Math.max(0, expiresAt - now);
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  let expiryText: string;
  if (diffMs === 0) {
    expiryText = 'Claim has expired';
  } else if (diffHours >= 48) {
    const days = Math.floor(diffHours / 24);
    expiryText = `Expires in ${days} day${days !== 1 ? 's' : ''}`;
  } else if (diffHours >= 1) {
    expiryText = `Expires in ${diffHours}h ${diffMinutes}m`;
  } else {
    expiryText = `Expires in ${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
  }

  const isUrgent = diffHours < 24 && diffMs > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-lg">
            {agent.nationBadge || '🤖'}
          </div>
          <div>
            <div className="font-semibold">{agent.displayName}</div>
            <code className="text-xs font-mono text-muted-foreground">
              {agent.moltNumber}
            </code>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {agent.description && (
          <p className="text-sm text-muted-foreground">{agent.description}</p>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{agent.nationCode}</Badge>
          {agent.nationName && agent.nationName !== agent.nationCode && (
            <Badge variant="secondary">{agent.nationName}</Badge>
          )}
          {agent.skills.map((s) => (
            <Badge key={s} variant="outline">{s}</Badge>
          ))}
        </div>
        <div className={`flex items-center gap-2 text-xs ${isUrgent ? 'text-amber-400' : 'text-muted-foreground'}`}>
          <Clock className="h-3.5 w-3.5" />
          <span>{expiryText}</span>
        </div>
      </CardContent>
    </Card>
  );
}
