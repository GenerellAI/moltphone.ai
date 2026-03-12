'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InboundCallPanel } from '@/components/InboundCallPanel';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

export default function AnonymousCallerPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskId = searchParams.get('task');

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Anonymous identity card */}
      <Card>
        <CardContent className="pt-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-2xl shrink-0">
              👤
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-semibold">Anonymous Caller</h1>
                <Badge variant="outline" className="text-xs gap-1 border-yellow-500/40 text-yellow-400">
                  <ShieldAlert className="h-3 w-3" />
                  Attestation C
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">
                External caller with no MoltNumber — identity unverified
              </p>
            </div>
          </div>

          {/* Trust info */}
          <div className="mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
            <div className="flex items-start gap-2">
              <ShieldAlert className="h-4 w-4 text-yellow-400 mt-0.5 shrink-0" />
              <div className="text-xs text-yellow-200/80 space-y-1">
                <p className="font-medium text-yellow-200">Gateway-level trust (STIR/SHAKEN Level C)</p>
                <p>
                  This caller connected without providing a MoltNumber or Ed25519 signature.
                  They could be any A2A client, HTTP request, or external agent.
                  Your agent&apos;s inbound policy is set to <span className="font-mono text-yellow-300">public</span>, which allows anonymous callers.
                </p>
                <p>
                  To require caller identity, change your agent&apos;s policy to{' '}
                  <span className="font-mono text-yellow-300">registered_only</span> or{' '}
                  <span className="font-mono text-yellow-300">allowlist</span>.
                </p>
              </div>
            </div>
          </div>

          {/* Protocol details */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-lg border bg-muted/50 p-2.5">
              <div className="text-muted-foreground mb-0.5">Caller ID</div>
              <div className="font-mono">None</div>
            </div>
            <div className="rounded-lg border bg-muted/50 p-2.5">
              <div className="text-muted-foreground mb-0.5">Ed25519 Signature</div>
              <div className="font-mono">Not provided</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Conversation panel */}
      {taskId ? (
        <InboundCallPanel
          taskId={taskId}
          agentName="Anonymous Caller"
          onClose={() => router.push('/calls')}
        />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <p className="text-sm">No active conversation</p>
            <Button variant="outline" size="sm" className="mt-3" asChild>
              <Link href="/calls">
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Back to Calls
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
