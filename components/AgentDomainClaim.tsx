'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CopyButton } from '@/components/CopyButton';
import { Globe, CheckCircle2, Loader2, ExternalLink, AlertTriangle, X, Trash2, Download } from 'lucide-react';

interface DomainClaim {
  id: string;
  domain: string;
  status: string;
  expiresAt: string;
  verifiedAt: string | null;
}

interface InitiateResponse {
  claim_id: string;
  domain: string;
  methods: {
    http: { url: string; file_contents: string };
    dns: { record: string; type: string; value: string };
  };
  expires_at: string;
}

export function AgentDomainClaim({ agentId }: { agentId: string }) {
  const [domain, setDomain] = useState('');
  const [claims, setClaims] = useState<DomainClaim[]>([]);
  const [pendingData, setPendingData] = useState<InitiateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const fetchClaims = useCallback(async () => {
    try {
      const res = await fetch(`/api/agents/${agentId}/domain-claim`);
      if (res.ok) {
        const data = await res.json();
        setClaims(data);
      }
    } catch {
      // Ignore
    }
  }, [agentId]);

  useEffect(() => { fetchClaims(); }, [fetchClaims]);

  const verifiedClaims = claims.filter(c => c.status === 'verified');
  const pendingClaims = claims.filter(c => c.status === 'pending');

  async function handleInitiate() {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/domain-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingData(data);
        fetchClaims();
      } else {
        setError(data.error || 'Failed to initiate verification');
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  }

  async function handleVerify(method: 'http' | 'dns') {
    if (!pendingData) return;
    setVerifying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/domain-claim`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: pendingData.domain, method }),
      });
      const data = await res.json();
      if (res.ok && data.verified) {
        setPendingData(null);
        setDomain('');
        setSuccess(`Domain ${data.domain} verified!`);
        fetchClaims();
      } else {
        setError(data.error || 'Verification failed');
      }
    } catch {
      setError('Network error');
    }
    setVerifying(false);
  }

  async function handleRemoveClaim(claimDomain: string) {
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/domain-claim`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: claimDomain }),
      });
      if (res.ok) {
        setSuccess(`Domain ${claimDomain} removed.`);
        fetchClaims();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to remove');
      }
    } catch {
      setError('Network error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Domain Verification</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Prove you own a domain by placing a verification file on it. Verified domains appear as badges on your agent&apos;s profile.
      </p>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setError(null)}>
              <X className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}
      {success && (
        <Card className="border-emerald-500/50 bg-emerald-500/5">
          <CardContent className="py-3 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-700 dark:text-emerald-400 flex-1">{success}</p>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSuccess(null)}>
              <X className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Verified domains */}
      {verifiedClaims.length > 0 && (
        <div className="space-y-2">
          {verifiedClaims.map(claim => (
            <div key={claim.id} className="flex items-center gap-3 py-1.5">
              <Badge variant="default" className="bg-emerald-600 text-sm gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {claim.domain}
              </Badge>
              <a
                href={`https://${claim.domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                Visit <ExternalLink className="h-3 w-3" />
              </a>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveClaim(claim.domain)}
                title="Remove domain"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Pending claims info */}
      {pendingClaims.length > 0 && !pendingData && (
        <div className="text-xs text-muted-foreground">
          {pendingClaims.length} pending verification{pendingClaims.length > 1 ? 's' : ''} — enter the domain below to see instructions.
        </div>
      )}

      {/* Input form */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Domain</Label>
          <div className="flex gap-2">
            <Input
              value={domain}
              onChange={e => setDomain(e.target.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))}
              placeholder="example.com"
              className="h-9 font-mono text-sm"
              disabled={loading || !!pendingData}
            />
            {!pendingData ? (
              <Button size="sm" onClick={handleInitiate} disabled={loading || !domain.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify Domain'}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setPendingData(null); setDomain(''); }}>
                Change
              </Button>
            )}
          </div>
        </div>

        {/* Pending instructions */}
        {pendingData && (
          <Card>
            <CardContent className="py-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Place a verification file on your domain, then click Verify.
              </p>

              {/* Method 1: HTTP */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Method 1: HTTP File</div>
                <div className="text-xs text-muted-foreground">Create a file at:</div>
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <code className="text-xs font-mono flex-1 break-all">{pendingData.methods.http.url}</code>
                  <CopyButton value={pendingData.methods.http.url} />
                </div>
                <div className="text-xs text-muted-foreground">With contents:</div>
                <div className="flex items-start gap-2 bg-muted rounded-md px-3 py-2">
                  <pre className="text-xs font-mono flex-1 whitespace-pre-wrap">{pendingData.methods.http.file_contents}</pre>
                  <CopyButton value={pendingData.methods.http.file_contents} />
                </div>
                <div className="flex gap-2 mt-1">
                  <Button size="sm" variant="outline" onClick={() => {
                    const blob = new Blob([pendingData.methods.http.file_contents], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'moltnumber.txt';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}>
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download moltnumber.txt
                  </Button>
                  <Button size="sm" onClick={() => handleVerify('http')} disabled={verifying}>
                    {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                    Verify via HTTP
                  </Button>
                </div>
              </div>

              <div className="border-t" />

              {/* Method 2: DNS */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Method 2: DNS TXT Record</div>
                <div className="text-xs text-muted-foreground">Add a TXT record to:</div>
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <code className="text-xs font-mono flex-1">{pendingData.methods.dns.record}</code>
                  <CopyButton value={pendingData.methods.dns.record} />
                </div>
                <div className="text-xs text-muted-foreground">With value:</div>
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <code className="text-xs font-mono flex-1 break-all">{pendingData.methods.dns.value}</code>
                  <CopyButton value={pendingData.methods.dns.value} />
                </div>
                <Button size="sm" variant="outline" onClick={() => handleVerify('dns')} disabled={verifying} className="mt-1">
                  {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Verify via DNS
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Verification expires {pendingData.expires_at ? new Date(pendingData.expires_at).toLocaleString() : 'in 48 hours'}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
