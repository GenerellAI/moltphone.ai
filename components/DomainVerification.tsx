'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/CopyButton';
import { CheckCircle2, Loader2, ExternalLink, AlertTriangle, X, Download, FileText } from 'lucide-react';

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

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
      <p className="text-xs text-muted-foreground">
        Prove you own a domain by placing a verification file on it. Verified domains appear as a badge on your nation&apos;s profile.
      </p>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <p className="text-sm text-destructive flex-1">{error}</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setError(null)}><X className="h-3 w-3" /></Button>
        </div>
      )}
      {success && (
        <div className="rounded-md border border-emerald-500/50 bg-emerald-500/5 px-3 py-2 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
          <p className="text-sm text-emerald-700 dark:text-emerald-400 flex-1">{success}</p>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setSuccess(null)}><X className="h-3 w-3" /></Button>
        </div>
      )}

      {/* Verified */}
      {status?.status === 'verified' && (
        <div className="flex items-center gap-3 py-2">
          <Badge variant="default" className="bg-emerald-600 text-sm gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" /> {status.domain}
          </Badge>
          <a href={`https://${status.domain}`} target="_blank" rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
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
              <Input value={domain}
                onChange={e => setDomain(e.target.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))}
                placeholder="example.com" className="h-9 font-mono text-sm"
                disabled={loading || !!pendingData} />
              {!pendingData ? (
                <Button size="sm" onClick={handleInitiate} disabled={loading || !domain.trim()}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start Verification'}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => { setPendingData(null); setDomain(''); }}>Change</Button>
              )}
            </div>
          </div>

          {pendingData && (
            <div className="space-y-6 pt-2">
              {/* Method 1: HTTP Well-Known */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Option 1 — HTTP Well-Known File</h4>
                <p className="text-xs text-muted-foreground">
                  Create a file named <code className="text-[11px] bg-muted px-1 py-0.5 rounded font-mono">moltnation.json</code> and
                  serve it at the following URL on your domain:
                </p>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">File URL</Label>
                  <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                    <code className="text-xs font-mono flex-1 break-all select-all">{pendingData.methods.http.url}</code>
                    <CopyButton value={pendingData.methods.http.url} />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    File Contents — <code className="font-mono">.well-known/moltnation.json</code>
                  </Label>
                  <div className="relative rounded-md border bg-zinc-950 dark:bg-zinc-900">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                      <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5">
                        <FileText className="h-3 w-3" /> moltnation.json
                      </span>
                      <CopyButton value={pendingData.methods.http.file_contents} />
                    </div>
                    <pre className="px-3 py-3 text-xs font-mono text-zinc-200 whitespace-pre-wrap overflow-x-auto select-all">{pendingData.methods.http.file_contents}</pre>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => downloadFile('moltnation.json', pendingData.methods.http.file_contents)}>
                    <Download className="h-3.5 w-3.5 mr-1.5" /> Download moltnation.json
                  </Button>
                  <Button size="sm" onClick={() => handleVerify('http')} disabled={verifying}>
                    {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                    Verify via HTTP
                  </Button>
                </div>
              </div>

              <div className="border-t" />

              {/* Method 2: DNS TXT */}
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Option 2 — DNS TXT Record</h4>
                <p className="text-xs text-muted-foreground">
                  Add a <code className="text-[11px] bg-muted px-1 py-0.5 rounded font-mono">TXT</code> record to your DNS configuration.
                </p>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Record Name</Label>
                  <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                    <code className="text-xs font-mono flex-1 select-all">{pendingData.methods.dns.record}</code>
                    <CopyButton value={pendingData.methods.dns.record} />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Record Value</Label>
                  <div className="relative rounded-md border bg-zinc-950 dark:bg-zinc-900">
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                      <span className="text-[10px] font-mono text-zinc-400">TXT record</span>
                      <CopyButton value={pendingData.methods.dns.value} />
                    </div>
                    <pre className="px-3 py-3 text-xs font-mono text-zinc-200 whitespace-pre-wrap overflow-x-auto select-all">{pendingData.methods.dns.value}</pre>
                  </div>
                </div>

                <Button size="sm" variant="outline" onClick={() => handleVerify('dns')} disabled={verifying}>
                  {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                  Verify via DNS
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Verification expires {pendingData.expires_at ? new Date(pendingData.expires_at).toLocaleString() : 'in 48 hours'}.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
