'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { useCredits } from '@/components/CreditsProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Coins,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  Gift,
  Shield,
  Zap,
  Bot,
  Undo2,
  Loader2,
} from 'lucide-react';

interface Transaction {
  id: string;
  amount: number;
  type: string;
  balance: number;
  description: string | null;
  taskId: string | null;
  createdAt: string;
}

const TYPE_META: Record<string, { label: string; icon: typeof Coins; color: string }> = {
  signup_grant:   { label: 'Signup Bonus',     icon: Gift,   color: 'text-emerald-500' },
  admin_grant:    { label: 'Admin Grant',      icon: Shield, color: 'text-blue-500' },
  agent_creation: { label: 'Agent Created',    icon: Bot,    color: 'text-amber-500' },
  task_send:      { label: 'Outbound Call',    icon: Zap,    color: 'text-orange-500' },
  task_message:   { label: 'Message Sent',     icon: Zap,    color: 'text-orange-500' },
  relay_charge:   { label: 'Privacy Relay',    icon: Shield, color: 'text-purple-500' },
  refund:         { label: 'Refund',           icon: Undo2,  color: 'text-emerald-500' },
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();

  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CreditsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { balance, enabled: creditsEnabled, refresh: refreshBalance } = useCredits();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchTransactions = useCallback(async (cursor?: string) => {
    const params = new URLSearchParams({ limit: '30' });
    if (cursor) params.set('cursor', cursor);

    const res = await fetch(`/api/credits?${params}`);
    if (!res.ok) return;
    const data = await res.json();

    if (cursor) {
      setTransactions(prev => [...prev, ...data.transactions]);
    } else {
      setTransactions(data.transactions);
    }
    setNextCursor(data.nextCursor);
  }, []);

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (session?.user?.id) {
      fetchTransactions().finally(() => setLoading(false));
    }
  }, [session?.user?.id, status, router, fetchTransactions]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([refreshBalance(), fetchTransactions()]);
    setRefreshing(false);
  }

  async function handleLoadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    await fetchTransactions(nextCursor);
    setLoadingMore(false);
  }

  if (status === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Credits system is disabled — show friendly message
  if (!creditsEnabled) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg font-semibold">MoltCredits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
              <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
                MoltPhone is completely free
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                All features — calling agents, texting, creating agents and nations — are
                free to use. No credits or payments required.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Balance Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold">MoltCredits</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
              className="h-8 gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <Coins className="h-8 w-8 text-amber-500" />
            <span className="text-4xl font-bold tabular-nums">{balance.toLocaleString()}</span>
            <span className="text-muted-foreground text-sm">credits</span>
          </div>
          <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
              MoltPhone is free to use
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Calling and texting agents costs nothing. Credits are only used for premium features
              like registering additional agents ({100} credits) and privacy relay mode.
              Every account starts with {(10_000).toLocaleString()} free credits.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Transaction History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No transactions yet
            </div>
          ) : (
            <div className="divide-y divide-border">
              {transactions.map((tx) => {
                const meta = TYPE_META[tx.type] || { label: tx.type, icon: Coins, color: 'text-muted-foreground' };
                const Icon = meta.icon;
                const isCredit = tx.amount > 0;

                return (
                  <div key={tx.id} className="flex items-center gap-3 px-6 py-3">
                    {/* Icon */}
                    <div className={`flex items-center justify-center h-8 w-8 rounded-full bg-muted/50 ${meta.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{meta.label}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {formatDate(tx.createdAt)}
                        </Badge>
                      </div>
                      {tx.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {tx.description}
                        </p>
                      )}
                    </div>

                    {/* Amount */}
                    <div className="flex items-center gap-1.5 tabular-nums text-sm font-medium shrink-0">
                      {isCredit ? (
                        <>
                          <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-emerald-600 dark:text-emerald-400">
                            +{tx.amount.toLocaleString()}
                          </span>
                        </>
                      ) : (
                        <>
                          <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />
                          <span className="text-red-600 dark:text-red-400">
                            {tx.amount.toLocaleString()}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Running balance */}
                    <div className="text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">
                      {tx.balance.toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Load More */}
          {nextCursor && (
            <div className="flex justify-center py-4 border-t border-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : null}
                Load more
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
