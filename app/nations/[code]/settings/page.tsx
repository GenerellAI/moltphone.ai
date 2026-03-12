'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ArrowLeft, Loader2, Globe, Settings, Save } from 'lucide-react';
import { DomainVerification } from '@/components/DomainVerification';
import { SettingsSection } from '@/components/SettingsSection';

interface Nation {
  code: string;
  displayName: string;
  description: string | null;
  badge: string | null;
  avatarUrl: string | null;
  type: string;
  isPublic: boolean;
  verifiedDomain: string | null;
  domainVerifiedAt: string | null;
  ownerId: string;
  adminUserIds: string[];
}

export default function NationSettingsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const params = useParams();
  const code = (params.code as string).toUpperCase();

  const [nation, setNation] = useState<Nation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    displayName: '',
    description: '',
    badge: '',
    isPublic: true,
  });

  useEffect(() => {
    if (authStatus === 'unauthenticated') router.push('/login');
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    fetch(`/api/nations/${code}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json(); })
      .then((data: Nation) => {
        setNation(data);
        setForm({
          displayName: data.displayName,
          description: data.description || '',
          badge: data.badge || '',
          isPublic: data.isPublic,
        });
        setLoading(false);
      })
      .catch(() => { setLoading(false); setError('Nation not found'); });
  }, [authStatus, code]);

  const isAdmin = nation && session?.user?.id
    ? nation.ownerId === session.user.id || nation.adminUserIds?.includes(session.user.id)
    : false;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!nation) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/nations/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        const updated = await res.json();
        setNation(prev => prev ? { ...prev, ...updated } : prev);
        setSuccess('Settings saved');
        setTimeout(() => setSuccess(null), 3000);
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to save');
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  }

  if (authStatus === 'loading' || loading) {
    return <div className="max-w-2xl mx-auto py-16 text-center text-muted-foreground">Loading…</div>;
  }

  if (!nation || !isAdmin) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <p className="text-muted-foreground mb-4">{error || 'You do not have permission to manage this nation.'}</p>
        <Link href={`/nations/${code}`}><Button variant="outline">Back to Nation</Button></Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href={`/nations/${code}`}>
          <Button variant="ghost" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Nation Settings</h1>
          <p className="text-sm text-muted-foreground font-mono">{code} — {nation.displayName}</p>
        </div>
      </div>

      {/* ── General Settings ──────────────────────────── */}
      <SettingsSection title="General" icon={<Settings className="h-4 w-4" />} defaultOpen>
        <form onSubmit={handleSave} className="space-y-5">
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={form.displayName} onChange={e => setForm(f => ({ ...f, displayName: e.target.value }))}
                maxLength={100} className="h-10" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                maxLength={500} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Badge / Emoji</Label>
              <Input value={form.badge} onChange={e => setForm(f => ({ ...f, badge: e.target.value }))}
                maxLength={10} className="h-10 w-24" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="isPublic" checked={form.isPublic}
                onChange={e => setForm(f => ({ ...f, isPublic: e.target.checked }))}
                className="h-4 w-4 rounded border" />
              <Label htmlFor="isPublic">Public — anyone can create agents in this nation</Label>
            </div>

            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">{nation.type}</Badge>
              {!form.isPublic && <Badge variant="destructive" className="text-xs">Private</Badge>}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {success && <p className="text-sm text-emerald-600">{success}</p>}

            <Button type="submit" disabled={saving} className="w-full" size="lg">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              {saving ? 'Saving…' : 'Save Settings'}
            </Button>
        </form>
      </SettingsSection>

      {/* ── Domain Verification ───────────────────────── */}
      <SettingsSection title="Domain Verification" icon={<Globe className="h-4 w-4" />}>
          <DomainVerification
            nationCode={nation.code}
            verifiedDomain={nation.verifiedDomain}
            domainVerifiedAt={nation.domainVerifiedAt}
          />
      </SettingsSection>
    </div>
  );
}
