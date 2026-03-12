'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { CopyButton } from '@/components/CopyButton';
import { CheckCircle2, Loader2, ExternalLink, AlertTriangle, X, Trash2, Download, FileText, ChevronDown } from 'lucide-react';

function downloadFile(filename: string, content: string) {
  const blob = new Blob([content], { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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

interface OwnedAgent {
  id: string;
  moltNumber: string;
  displayName: string;
  nationCode: string;
}

export function AgentDomainClaim({ agentId }: { agentId: string }) {
  const [domain, setDomain] = useState('');
  const [claims, setClaims] = useState<DomainClaim[]>([]);
  const [pendingData, setPendingData] = useState<InitiateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [ownedAgents, setOwnedAgents] = useState<OwnedAgent[]>([]);
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<string>>(new Set());


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

  /** Fetch other agents owned by the user (excluding the current one) */
  const fetchOwnedAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents/mine');
      if (res.ok) {
        const data = await res.json();
        const agents = (Array.isArray(data) ? data : data.agents || []) as OwnedAgent[];
        setOwnedAgents(agents.filter((a: OwnedAgent) => a.id !== agentId));
      }
    } catch {
      // Ignore
    }
  }, [agentId]);

  useEffect(() => { fetchClaims(); fetchOwnedAgents(); }, [fetchClaims, fetchOwnedAgents]);

  const verifiedClaims = claims.filter(c => c.status === 'verified');
  const pendingClaims = claims.filter(c => c.status === 'pending');

  async function handleInitiate() {
    if (!domain.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const includeAgentIds = selectedAgentIds.size > 0 ? Array.from(selectedAgentIds) : undefined;
      const res = await fetch(`/api/agents/${agentId}/domain-claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: domain.trim(), includeAgentIds }),
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
      <p className="text-xs text-muted-foreground">
        Prove you own a domain by placing a verification file on it. Verified domains appear as badges on your agent&apos;s profile.
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

      {/* Verified domains */}
      {verifiedClaims.length > 0 && (
        <div className="space-y-2">
          {verifiedClaims.map(claim => (
            <div key={claim.id} className="flex items-center gap-3 py-1.5">
              <Badge variant="default" className="bg-emerald-600 text-sm gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> {claim.domain}
              </Badge>
              <a href={`https://${claim.domain}`} target="_blank" rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                Visit <ExternalLink className="h-3 w-3" />
              </a>
              <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemoveClaim(claim.domain)} title="Remove domain">
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
            <Input value={domain}
              onChange={e => setDomain(e.target.value.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''))}
              placeholder="example.com" className="h-9 font-mono text-sm"
              disabled={loading || !!pendingData} />
            {!pendingData ? (
              <Button size="sm" onClick={handleInitiate} disabled={loading || !domain.trim()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify Domain'}
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => { setPendingData(null); setDomain(''); }}>Change</Button>
            )}
          </div>
        </div>

        {/* Include additional agents in verification file */}
        {ownedAgents.length > 0 && !pendingData && (
          <div className="rounded-md border p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold">Include additional agents</span>
              <span className="text-[10px] text-muted-foreground">— one file, multiple MoltNumbers</span>
            </div>
            {ownedAgents.map(a => (
              <label key={a.id} className="flex items-center gap-2.5 py-1 cursor-pointer group">
                <Checkbox
                  checked={selectedAgentIds.has(a.id)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedAgentIds);
                    if (checked) next.add(a.id);
                    else next.delete(a.id);
                    setSelectedAgentIds(next);
                  }}
                />
                <span className="text-xs font-medium group-hover:text-foreground">{a.displayName}</span>
                <span className="text-[11px] font-mono text-muted-foreground">{a.moltNumber}</span>
              </label>
            ))}
          </div>
        )}

        {pendingData && (
          <div className="space-y-6 pt-2">
            {/* Method 1: HTTP Well-Known */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Option 1 — HTTP Well-Known File</h4>
              <p className="text-xs text-muted-foreground">
                Create a file named <code className="text-[11px] bg-muted px-1 py-0.5 rounded font-mono">moltnumber.json</code> and
                serve it at the following URL on your domain:
              </p>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">File URL</Label>
                <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
                  <code className="text-xs font-mono flex-1 break-all select-all">{pendingData.methods.http.url}</code>
                  <CopyButton value={pendingData.methods.http.url} />
                </div>
              </div>

              <Button className="w-full" onClick={() => downloadFile('moltnumber.json', pendingData.methods.http.file_contents)}>
                <Download className="h-4 w-4 mr-2" /> Download moltnumber.json
              </Button>

              <details className="group">
                <summary className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground hover:text-foreground transition-colors select-none py-1">
                  <ChevronDown className="h-3 w-3 group-open:rotate-180 transition-transform" />
                  View file contents
                </summary>
                <div className="mt-2 relative rounded-md border bg-zinc-950 dark:bg-zinc-900">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800">
                    <span className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> moltnumber.json
                    </span>
                    <CopyButton value={pendingData.methods.http.file_contents} />
                  </div>
                  <pre className="px-3 py-3 text-xs font-mono text-zinc-200 whitespace-pre-wrap overflow-x-auto select-all max-h-64 overflow-y-auto">{pendingData.methods.http.file_contents}</pre>
                </div>
              </details>

              <Button size="sm" onClick={() => handleVerify('http')} disabled={verifying}>
                {verifying ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                Verify via HTTP
              </Button>
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
    </div>
  );
}
