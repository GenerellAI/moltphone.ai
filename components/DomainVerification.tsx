'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { CopyButton } from '@/components/CopyButton';
import { Globe, CheckCircle2, Loader2, ExternalLink, AlertTriangle, X, Download } from 'lucide-react';

interface DomainVerificationProps {
  nationCode: string;
  /** Current verified domain (null if none) */
  verifiedDomain: string | null;
  /** When the domain was verified */
  domainVerifiedAt: string | null;
}

interface VerificationStatus {
  status: 'none' | 'pending' | 'verified';
  domain?: string;
  expires_at?: string;
  verified_at?: string;
}

interface InitiateResponse {
  domain: string;
  methods: {
    http: { url: string; file_contents: string };
    dns: { record: string; type: string; value: string };
  };
  expires_at: string;
}

export function DomainVerification({ nationCode, verifiedDomain, domainVerifiedAt }: DomainVerificationProps) {
  const [domain, setDomain] = useState('');
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [pendingData, setPendingData] = useState<InitiateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Initialize from props
  useEffect(() => {
    if (verifiedDomain && domainVerifiedAt && !verifiedDomain.startsWith('pending:')) {
      setStatus({ status: 'verified', domain: verifiedDomain, verified_at: domainVerifiedAt });
    } else {
      // Fetch latest status from API
      fetchStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nationCode]);

  async function fetchStatus() {
    try {
      const res = await fetch(`/api/nations/${nationCode}/verify-domain`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.status === 'pending' && data.domain) {
          setDomain(data.domain);
        }
      }
    } catch {
      // Ignore — we'll just show the form
    }
  }

  async function handleInitiate() {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/nations/${nationCode}/verify-domain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        setPendingData(data);
        setStatus({ status: 'pending', domain: data.domain, expires_at: data.expires_at });
      } else {
        setError(data.error || 'Failed to initiate verification');
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  }

  async function handleVerify(method: 'http' | 'dns') {
    setVerifying(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/nations/${nationCode}/verify-domain`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });
      const data = await res.json();
      if (res.ok && data.verified) {
        setStatus({ status: 'verified', domain: data.domain, verified_at: data.verified_at });
        setPendingData(null);
        setSuccess(`Domain ${data.domain} verified successfully!`);
      } else {
        setError(data.error || 'Verification failed');
      }
    } catch {
      setError('Network error');
    }
    setVerifying(false);
  }

  async function handleRemoveDomain() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      // Initiate with empty = clear. We'll use POST with a new domain to replace,
      // or we store null. For now, initiate with a different domain replaces.
      // To remove, we PATCH the nation's verifiedDomain to null via admin API.
      // Actually the simplest: POST a new initiation will overwrite the old one.
      // To fully remove, let's just re-initiate which clears the verified state.
      // Better: Let's add a small helper — just set verifiedDomain to null.
      const res = await fetch(`/api/nations/${nationCode}/verify-domain`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setStatus({ status: 'none' });
        setPendingData(null);
        setDomain('');
        setSuccess('Domain verification removed.');
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to remove domain');
      }
    } catch {
      setError('Network error');
    }
    setLoading(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Domain Verification</h3>
      </div>

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

      {/* Verified state */}
      {status?.status === 'verified' && (
        <div className="flex items-center gap-3 py-2">
          <Badge variant="default" className="bg-emerald-600 text-sm gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {status.domain}
          </Badge>
          <a
            href={`https://${status.domain}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Visit <ExternalLink className="h-3 w-3" />
          </a>
          <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={handleRemoveDomain} disabled={loading}>
            Remove
          </Button>
        </div>
      )}

      {/* Input form */}
      {status?.status !== 'verified' && (
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
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start Verification'}
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
                  Place a verification file on your domain using one of the methods below, then click Verify.
                </p>

                {/* Method 1: HTTP Well-Known */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Method 1: HTTP File</div>
                  <div className="text-xs text-muted-foreground">
                    Create a file at:
                  </div>
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
                      a.download = 'moltnation.txt';
                      a.click();
                      URL.revokeObjectURL(url);
                    }}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Download moltnation.txt
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleVerify('http')}
                      disabled={verifying}
                    >
                      {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                      Verify via HTTP
                    </Button>
                  </div>
                </div>

                <div className="border-t" />

                {/* Method 2: DNS TXT */}
                <div className="space-y-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">Method 2: DNS TXT Record</div>
                  <div className="text-xs text-muted-foreground">
                    Add a TXT record to:
                  </div>
                  <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                    <code className="text-xs font-mono flex-1">{pendingData.methods.dns.record}</code>
                    <CopyButton value={pendingData.methods.dns.record} />
                  </div>
                  <div className="text-xs text-muted-foreground">With value:</div>
                  <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                    <code className="text-xs font-mono flex-1 break-all">{pendingData.methods.dns.value}</code>
                    <CopyButton value={pendingData.methods.dns.value} />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleVerify('dns')}
                    disabled={verifying}
                    className="mt-1"
                  >
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
      )}
    </div>
  );
}
