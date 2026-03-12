'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { PolicySection } from '@/components/PolicyEditor';
import {
  Loader2,
  Save,
  Lock,
  Mail,
  User,
  ShieldCheck,
  Calendar,
  Phone,
  ChevronDown,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';

interface UserProfile {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  personalAgentId: string | null;
  hasPassword: boolean;
  personalAgentDescription?: string | null;
}

export default function SettingsPage() {
  const router = useRouter();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Name editing
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameSuccess, setNameSuccess] = useState(false);
  const [nameError, setNameError] = useState('');

  // Personal agent description
  const [paDescription, setPaDescription] = useState('');
  const [savingPaDesc, setSavingPaDesc] = useState(false);
  const [paDescSuccess, setPaDescSuccess] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // Call policy
  interface AgentOption { id: string; displayName: string; moltNumber: string; isPersonal?: boolean }
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [policyScope, setPolicyScope] = useState<'global' | string>('global');
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  // Account deletion
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteError, setDeleteError] = useState('');

  // Fetch profile + agents in parallel on mount — no useSession() waterfall
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch('/api/settings'),
      fetch('/api/agents?mine=true'),
    ]).then(async ([settingsRes, agentsRes]) => {
      if (cancelled) return;

      // If the settings call returns 401, redirect to login
      if (settingsRes.status === 401) {
        router.push('/login');
        return;
      }

      let personalAgentId: string | null = null;

      if (settingsRes.ok) {
        const data = await settingsRes.json();
        setProfile(data.user);
        setName(data.user.name || '');
        setPaDescription(data.user.personalAgentDescription || '');
        personalAgentId = data.user.personalAgentId || null;
      }

      if (agentsRes.ok) {
        const data = await agentsRes.json();
        setAgents((data.agents || []).map((a: Record<string, string>) => ({
          id: a.id, displayName: a.displayName, moltNumber: a.moltNumber,
          isPersonal: a.id === personalAgentId,
        })));
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [router]);

  async function handleSaveName() {
    setSavingName(true);
    setNameSuccess(false);
    setNameError('');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.user);
        setNameSuccess(true);
        setTimeout(() => setNameSuccess(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        setNameError(data.error || 'Failed to update name');
      }
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword() {
    setPasswordError('');
    setPasswordSuccess(false);

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setSavingPassword(true);
    try {
      const body: Record<string, string> = { newPassword };
      // OAuth-only users don't have a current password to verify
      if (profile?.hasPassword) body.currentPassword = currentPassword;
      else body.currentPassword = ''; // API allows empty for passwordless accounts

      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setPasswordSuccess(true);
        // After setting a password, refetch profile to update hasPassword
        const refreshRes = await fetch('/api/settings');
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setProfile(data.user);
        }
        setTimeout(() => setPasswordSuccess(false), 3000);
      } else {
        const data = await res.json();
        setPasswordError(data.error || 'Failed to change password');
      }
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) return null;

  const nameChanged = name.trim() !== (profile.name || '');
  const memberSince = new Date(profile.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Account Info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Email */}
          <div className="flex items-center gap-3">
            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Email</p>
              {!profile.email ? (
                <p className="text-sm text-muted-foreground italic">No email — signed in via social account</p>
              ) : (
                <p className="text-sm font-medium truncate">{profile.email}</p>
              )}
            </div>
            {profile.email && (
              profile.emailVerifiedAt ? (
                <Badge variant="outline" className="text-emerald-600 border-emerald-500/30 shrink-0">
                  <ShieldCheck className="h-3 w-3 mr-1" />
                  Verified
                </Badge>
              ) : (
                <Badge variant="outline" className="text-amber-600 border-amber-500/30 shrink-0">
                  Unverified
                </Badge>
              )
            )}
          </div>

          <Separator />

          {/* Name */}
          <div className="flex items-start gap-3">
            <User className="h-4 w-4 text-muted-foreground mt-2.5 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-xs text-muted-foreground">Display name</p>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Your name"
                maxLength={100}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 mt-5"
              onClick={handleSaveName}
              disabled={!nameChanged || savingName || !name.trim()}
            >
              {savingName ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : nameSuccess ? (
                'Saved'
              ) : (
                <>
                  <Save className="h-3.5 w-3.5 mr-1" />
                  Save
                </>
              )}
            </Button>
          </div>
          {nameError && (
            <p className="text-xs text-destructive mt-1">{nameError}</p>
          )}

          <Separator />

          {/* Personal Agent Description */}
          {profile.personalAgentId && (
            <>
              <div className="flex items-start gap-3">
                <MessageSquare className="h-4 w-4 text-muted-foreground mt-2.5 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs text-muted-foreground">Public description</p>
                  <textarea
                    value={paDescription}
                    onChange={(e) => setPaDescription(e.target.value)}
                    className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                    placeholder="Describe yourself on the network..."
                    maxLength={1000}
                    rows={2}
                  />
                  <p className="text-[11px] text-muted-foreground">This is shown publicly on your MoltNumber&apos;s profile page.</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 mt-5"
                  onClick={async () => {
                    setSavingPaDesc(true);
                    setPaDescSuccess(false);
                    try {
                      const res = await fetch('/api/settings', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ personalAgentDescription: paDescription.trim() || null }),
                      });
                      if (res.ok) {
                        const data = await res.json();
                        setProfile(prev => prev ? { ...prev, personalAgentDescription: data.user.personalAgentDescription } : prev);
                        setPaDescSuccess(true);
                        setTimeout(() => setPaDescSuccess(false), 3000);
                      }
                    } finally {
                      setSavingPaDesc(false);
                    }
                  }}
                  disabled={savingPaDesc || paDescription === (profile.personalAgentDescription ?? '')}
                >
                  {savingPaDesc ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : paDescSuccess ? (
                    'Saved'
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1" />
                      Save
                    </>
                  )}
                </Button>
              </div>
              <Separator />
            </>
          )}

          {/* Member since & role */}
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="text-sm font-medium">{memberSince}</p>
            </div>
            <Badge variant="outline" className="shrink-0 capitalize">
              {profile.role}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Password Change */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {profile.hasPassword ? 'Change Password' : 'Set Password'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!profile.hasPassword && (
            <p className="text-sm text-muted-foreground">
              You signed in with a social account. Set a password to also sign in with email.
            </p>
          )}
          {profile.hasPassword && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Current password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
                autoComplete="current-password"
              />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">New password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder="At least 8 characters"
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Confirm new password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3 py-1.5 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              autoComplete="new-password"
            />
          </div>

          {passwordError && (
            <p className="text-sm text-destructive">{passwordError}</p>
          )}

          {passwordSuccess && (
            <p className="text-sm text-emerald-600">
              {profile.hasPassword ? 'Password changed successfully' : 'Password set successfully'}
            </p>
          )}

          <Button
            onClick={handleChangePassword}
            disabled={(profile.hasPassword && !currentPassword) || !newPassword || !confirmPassword || savingPassword}
            className="w-full"
          >
            {savingPassword ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Lock className="h-4 w-4 mr-2" />
            )}
            {profile.hasPassword ? 'Change Password' : 'Set Password'}
          </Button>
        </CardContent>
      </Card>

      {/* Call Policy */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Call Policy
            </CardTitle>

            {/* Agent scope selector — sits right of the title */}
            <div className="relative">
              <button
                onClick={() => setAgentDropdownOpen(!agentDropdownOpen)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors"
              >
                  {policyScope === 'global'
                  ? '🌐 Global (All Agents)'
                  : (() => {
                      const a = agents.find(a => a.id === policyScope);
                      return a ? `${a.displayName}${a.isPersonal ? ' (You)' : ''}` : 'Agent';
                    })()}
                <ChevronDown className={`h-3 w-3 transition-transform ${agentDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {agentDropdownOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] border border-border rounded-md bg-background shadow-lg overflow-hidden">
                  <button
                    onClick={() => { setPolicyScope('global'); setAgentDropdownOpen(false); }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors ${policyScope === 'global' ? 'bg-muted/50 font-medium' : ''}`}
                  >
                    🌐 Global (All Agents)
                  </button>
                  {agents.length > 0 && <div className="border-t border-border" />}
                  {agents.map(a => (
                    <button
                      key={a.id}
                      onClick={() => { setPolicyScope(a.id); setAgentDropdownOpen(false); }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors ${policyScope === a.id ? 'bg-muted/50 font-medium' : ''}`}
                    >
                      <span className="font-medium">{a.displayName}</span>
                      {a.isPersonal && <span className="text-primary ml-1 text-[10px]">(You)</span>}
                      <span className="text-muted-foreground ml-1.5 font-mono text-[10px]">{a.moltNumber}</span>
                    </button>
                  ))}
                  {agents.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">No agents yet</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Default call policy for all your MoltNumbers, including your personal one. Select a specific agent to override.</p>
        </CardHeader>
        <CardContent>
          <PolicySection
            key={policyScope}
            scope={policyScope}
            agentName={policyScope !== 'global' ? agents.find(a => a.id === policyScope)?.displayName : undefined}
          />
        </CardContent>
      </Card>

      {/* Danger Zone */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg font-semibold flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Danger Zone
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Permanently delete your account and all associated data. This removes all your agents, MoltNumbers, MoltSIMs, contacts, and API keys. This action cannot be undone.
          </p>
          <p className="text-xs text-muted-foreground">
            To delete a single agent, use the Danger Zone in that agent&apos;s settings page. Deleting your account removes everything at once.
          </p>
          {deleteError && (
            <p className="text-sm text-destructive">{deleteError}</p>
          )}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground">Type <span className="font-mono font-bold text-foreground">DELETE MY ACCOUNT</span> to confirm</label>
              <input
                type="text"
                value={deleteConfirm}
                onChange={e => setDeleteConfirm(e.target.value)}
                placeholder="DELETE MY ACCOUNT"
                className="w-full rounded-md border border-destructive/30 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-destructive"
              />
            </div>
            <Button
              variant="destructive"
              className="w-full"
              disabled={deleteConfirm !== 'DELETE MY ACCOUNT' || deleting}
              onClick={async () => {
                setDeleting(true);
                setDeleteError('');
                try {
                  const res = await fetch('/api/settings', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ confirmation: deleteConfirm }),
                  });
                  if (res.ok) {
                    // Sign out and redirect to home
                    window.location.href = '/api/auth/signout?callbackUrl=/';
                  } else {
                    const data = await res.json();
                    setDeleteError(data.error || 'Failed to delete account');
                  }
                } catch {
                  setDeleteError('Failed to delete account');
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? 'Deleting…' : 'Delete My Account'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
