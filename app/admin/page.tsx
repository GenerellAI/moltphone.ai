'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Shield,
  Ban,
  ScrollText,
  Coins,
  Trash2,
  Plus,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Play,
  Users,
  Bot,
  Globe,
  ArrowRightLeft,
  Settings2,
  Power,
  PowerOff,
  Crown,
  UserPlus,
  X,
  Search,
  ImagePlus,
  Upload,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useCredits } from '@/components/CreditsProvider';

// ── Types ────────────────────────────────────────────────

interface CarrierBlock {
  id: string;
  type: string;
  value: string;
  reason: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

interface CarrierPolicy {
  id: string;
  type: string;
  value: string;
  reason: string | null;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
}

interface CronResult {
  label: string;
  count: number;
  time: string;
  success: boolean;
}

// ── Helpers ──────────────────────────────────────────────

function timeAgo(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const BLOCK_TYPE_LABELS: Record<string, string> = {
  agent_id: 'Agent ID',
  molt_number_pattern: 'MoltNumber Pattern',
  nation_code: 'Nation Code',
  ip_address: 'IP Address',
};

const POLICY_TYPE_LABELS: Record<string, string> = {
  require_verified_domain: 'Require Verified Domain',
  require_social_verification: 'Require Social Verification',
  minimum_age_hours: 'Minimum Account Age (hours)',
};

// ── Tab Nav ──────────────────────────────────────────────

type Tab = 'overview' | 'nations' | 'blocks' | 'policies' | 'credits' | 'jobs';

const TABS: { id: Tab; label: string; icon: typeof Shield }[] = [
  { id: 'overview', label: 'Overview', icon: Shield },
  { id: 'nations', label: 'Nations', icon: Globe },
  { id: 'blocks', label: 'Blocks', icon: Ban },
  { id: 'policies', label: 'Policies', icon: ScrollText },
  { id: 'credits', label: 'Credits', icon: Coins },
  { id: 'jobs', label: 'Jobs', icon: Clock },
];

// ══════════════════════════════════════════════════════════
// ── Main Page ────────────────────────────────────────────
// ══════════════════════════════════════════════════════════

export default function AdminPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const { enabled: creditsEnabled } = useCredits();
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  // Check admin access
  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push('/login');
      return;
    }
    if (authStatus === 'authenticated') {
      // Quick check — try fetching carrier blocks (admin-only)
      fetch('/api/admin/carrier-blocks')
        .then(res => {
          setIsAdmin(res.ok);
          if (!res.ok) router.push('/');
        })
        .catch(() => {
          setIsAdmin(false);
          router.push('/');
        });
    }
  }, [authStatus, router]);

  if (authStatus === 'loading' || isAdmin === null) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!session || !isAdmin) return null;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <Shield className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">Carrier management & operations</p>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.filter(tab => tab.id !== 'credits' || creditsEnabled).map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'nations' && <NationsTab />}
      {activeTab === 'blocks' && <BlocksTab />}
      {activeTab === 'policies' && <PoliciesTab />}
      {activeTab === 'credits' && creditsEnabled && <CreditsTab />}
      {activeTab === 'jobs' && <JobsTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Nations Tab ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════

interface AdminNation {
  id: string;
  code: string;
  type: string;
  displayName: string;
  description: string | null;
  badge: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  isActive: boolean;
  provisionalUntil: string | null;
  verifiedDomain: string | null;
  ownerId: string;
  memberUserIds: string[];
  adminUserIds: string[];
  owner: { id: string; name: string | null; email: string };
  _count: { agents: number };
  createdAt: string;
}

interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

// ── UserPicker (searchable multi-select) ────────────────

function UserPicker({
  users,
  selectedIds,
  onChange,
  label,
  hint,
  excludeIds = [],
}: {
  users: AdminUser[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  label: string;
  hint?: string;
  excludeIds?: string[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter(u =>
      !selectedIds.includes(u.id) &&
      !excludeIds.includes(u.id) &&
      (q === '' ||
        (u.name?.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q))
    );
  }, [users, selectedIds, excludeIds, query]);

  function addUser(id: string) {
    onChange([...selectedIds, id]);
    setQuery('');
  }

  function removeUser(id: string) {
    onChange(selectedIds.filter(uid => uid !== id));
  }

  return (
    <div className="space-y-2" ref={wrapperRef}>
      <Label>{label}{hint && <span className="text-xs text-muted-foreground ml-1">{hint}</span>}</Label>
      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const u = users.find(u => u.id === id);
            return (
              <Badge key={id} variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-0.5">
                <span className="text-xs">{u?.name || u?.email || id.slice(0, 12)}</span>
                <button
                  type="button"
                  onClick={() => removeUser(id)}
                  className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-8 h-9"
          placeholder="Search users by name or email…"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {/* Dropdown results */}
      {open && (query || filtered.length > 0) && (
        <div className="border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">No matching users</p>
          ) : (
            filtered.slice(0, 20).map(u => (
              <button
                key={u.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between text-sm"
                onClick={() => { addUser(u.id); setOpen(false); }}
              >
                <div className="min-w-0">
                  <span className="font-medium">{u.name || '(no name)'}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{u.email}</span>
                </div>
                {u.role === 'admin' && (
                  <Badge variant="outline" className="text-xs ml-2 shrink-0">admin</Badge>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Single-user search picker (for transfer) ────────────

function UserSearchPicker({
  users,
  selectedId,
  onChange,
  excludeIds = [],
}: {
  users: AdminUser[];
  selectedId: string;
  onChange: (id: string) => void;
  excludeIds?: string[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return users.filter(u =>
      !excludeIds.includes(u.id) &&
      (q === '' ||
        (u.name?.toLowerCase().includes(q)) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q))
    );
  }, [users, excludeIds, query]);

  const selectedUser = users.find(u => u.id === selectedId);

  return (
    <div className="space-y-2" ref={wrapperRef}>
      {selectedId && selectedUser && (
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="flex items-center gap-1 pl-2 pr-1 py-1">
            <span className="text-sm">{selectedUser.name || selectedUser.email}</span>
            <span className="text-xs text-muted-foreground ml-1">{selectedUser.email}</span>
            <button
              type="button"
              onClick={() => { onChange(''); setQuery(''); }}
              className="ml-1 rounded-full hover:bg-muted-foreground/20 p-0.5"
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        </div>
      )}
      {!selectedId && (
        <>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Search users by name or email…"
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
            />
          </div>
          {open && (query || filtered.length > 0) && (
            <div className="border rounded-md bg-popover shadow-md max-h-48 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-2">No matching users</p>
              ) : (
                filtered.slice(0, 20).map(u => (
                  <button
                    key={u.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-center justify-between text-sm"
                    onClick={() => { onChange(u.id); setQuery(''); setOpen(false); }}
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{u.name || '(no name)'}</span>
                      <span className="text-muted-foreground ml-2 text-xs">{u.email}</span>
                    </div>
                    {u.role === 'admin' && (
                      <Badge variant="outline" className="text-xs ml-2 shrink-0">admin</Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const NATION_TYPE_COLORS: Record<string, string> = {
  carrier: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  org: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  open: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
};

function NationsTab() {
  const [nations, setNations] = useState<AdminNation[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialogs
  const [transferNation, setTransferNation] = useState<AdminNation | null>(null);
  const [transferUserId, setTransferUserId] = useState('');
  const [transferring, setTransferring] = useState(false);

  const [editNation, setEditNation] = useState<AdminNation | null>(null);
  const [editData, setEditData] = useState<{
    displayName: string;
    description: string;
    type: string;
    isPublic: boolean;
    memberUserIds: string[];
    adminUserIds: string[];
  }>({ displayName: '', description: '', type: 'open', isPublic: true, memberUserIds: [], adminUserIds: [] });
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState<string | null>(null); // nation code being uploaded

  // Create nation dialog
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newNation, setNewNation] = useState({
    code: '', type: 'open', displayName: '', description: '', badge: '', isPublic: true, ownerId: '',
  });

  // Delete confirmation
  const [deleteNation, setDeleteNation] = useState<AdminNation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setError(null);
    try {
      const [nRes, uRes] = await Promise.all([
        fetch('/api/admin/nations'),
        fetch('/api/admin/users'),
      ]);
      if (nRes.ok) setNations(await nRes.json());
      if (uRes.ok) setUsers(await uRes.json());
    } catch {
      setError('Failed to load data');
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleTransfer() {
    if (!transferNation || !transferUserId) return;
    setTransferring(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/nations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: transferNation.code, ownerId: transferUserId }),
      });
      if (res.ok) {
        setTransferNation(null);
        setTransferUserId('');
        fetchData();
      } else {
        const data = await res.json();
        setError(data.error || 'Transfer failed');
      }
    } catch {
      setError('Network error');
    }
    setTransferring(false);
  }

  async function handleToggleActive(nation: AdminNation) {
    setToggling(nation.code);
    try {
      await fetch('/api/admin/nations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: nation.code, isActive: !nation.isActive }),
      });
      fetchData();
    } catch { /* ignore */ }
    setToggling(null);
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        code: newNation.code.toUpperCase(),
        type: newNation.type,
        displayName: newNation.displayName,
        isPublic: newNation.isPublic,
      };
      if (newNation.description) payload.description = newNation.description;
      if (newNation.badge) payload.badge = newNation.badge;
      if (newNation.ownerId) payload.ownerId = newNation.ownerId;

      const res = await fetch('/api/admin/nations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setShowCreate(false);
        setNewNation({ code: '', type: 'open', displayName: '', description: '', badge: '', isPublic: true, ownerId: '' });
        fetchData();
      } else {
        const data = await res.json();
        setError(typeof data.error === 'string' ? data.error : JSON.stringify(data.error));
      }
    } catch {
      setError('Network error');
    }
    setCreating(false);
  }

  async function handleDelete() {
    if (!deleteNation) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/nations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: deleteNation.code }),
      });
      if (res.ok) {
        setDeleteNation(null);
        fetchData();
      } else {
        const data = await res.json();
        setError(data.error || 'Delete failed');
      }
    } catch {
      setError('Network error');
    }
    setDeleting(false);
  }

  async function handleAvatarUpload(nationCode: string, file: File) {
    setUploadingAvatar(nationCode);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/nations/${nationCode}/avatar`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        setError(data.error || 'Upload failed');
      }
    } catch {
      setError('Network error');
    }
    setUploadingAvatar(null);
  }

  async function handleAvatarRemove(nationCode: string) {
    setUploadingAvatar(nationCode);
    setError(null);
    try {
      const res = await fetch(`/api/nations/${nationCode}/avatar`, { method: 'DELETE' });
      if (res.ok) {
        fetchData();
      } else {
        const data = await res.json();
        setError(data.error || 'Remove failed');
      }
    } catch {
      setError('Network error');
    }
    setUploadingAvatar(null);
  }

  function openEdit(nation: AdminNation) {
    setEditNation(nation);
    setEditData({
      displayName: nation.displayName,
      description: nation.description || '',
      type: nation.type,
      isPublic: nation.isPublic,
      memberUserIds: [...nation.memberUserIds],
      adminUserIds: [...nation.adminUserIds],
    });
  }

  async function handleSaveEdit() {
    if (!editNation) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { code: editNation.code };
      if (editData.displayName !== editNation.displayName) payload.displayName = editData.displayName;
      if (editData.description !== (editNation.description || '')) payload.description = editData.description;
      if (editData.type !== editNation.type) payload.type = editData.type;
      if (editData.isPublic !== editNation.isPublic) payload.isPublic = editData.isPublic;

      if (JSON.stringify(editData.memberUserIds) !== JSON.stringify(editNation.memberUserIds)) payload.memberUserIds = editData.memberUserIds;
      if (JSON.stringify(editData.adminUserIds) !== JSON.stringify(editNation.adminUserIds)) payload.adminUserIds = editData.adminUserIds;

      // Only send if there's something to update
      if (Object.keys(payload).length <= 1) {
        setEditNation(null);
        setSaving(false);
        return;
      }

      const res = await fetch('/api/admin/nations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setEditNation(null);
        fetchData();
      } else {
        const data = await res.json();
        setError(typeof data.error === 'string' ? data.error : 'Save failed');
      }
    } catch {
      setError('Network error');
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Nations</h2>
          <p className="text-sm text-muted-foreground">Manage all nation codes — ownership, type, members, and status</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Create Nation
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchData(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => setError(null)}>
              <X className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Nations list */}
      <div className="space-y-2">
        {nations.map(nation => (
          <Card key={nation.code} className={!nation.isActive ? 'opacity-60' : undefined}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                {/* Avatar + info */}
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Nation avatar */}
                  <div className="relative shrink-0 group">
                    <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden border">
                      {nation.avatarUrl ? (
                        <img src={nation.avatarUrl} alt={nation.displayName} className="h-full w-full object-cover" />
                      ) : nation.badge ? (
                        <span className="text-lg">{nation.badge}</span>
                      ) : (
                        <Globe className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    {/* Upload overlay */}
                    <label
                      className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Upload avatar"
                    >
                      {uploadingAvatar === nation.code ? (
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      ) : (
                        <Upload className="h-3.5 w-3.5 text-white" />
                      )}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAvatarUpload(nation.code, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-base font-bold font-mono">{nation.code}</code>
                      <span className="text-sm font-medium">{nation.displayName}</span>
                      <Badge className={`text-xs ${NATION_TYPE_COLORS[nation.type] || ''}`} variant="outline">
                        {nation.type}
                      </Badge>
                      {!nation.isActive && (
                        <Badge variant="destructive" className="text-xs">Inactive</Badge>
                      )}
                      {nation.provisionalUntil && (
                        <Badge variant="outline" className="text-xs text-amber-600">
                          Provisional until {new Date(nation.provisionalUntil).toLocaleDateString()}
                        </Badge>
                      )}
                      {nation.verifiedDomain && (
                        <Badge variant="secondary" className="text-xs">
                          ✓ {nation.verifiedDomain}
                        </Badge>
                      )}
                    </div>

                    <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Crown className="h-3 w-3" />
                        {nation.owner.name || nation.owner.email}
                      </span>
                      <span className="flex items-center gap-1">
                        <Bot className="h-3 w-3" />
                        {nation._count.agents} agent{nation._count.agents !== 1 ? 's' : ''}
                      </span>
                      {nation.adminUserIds.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {nation.adminUserIds.length} admin{nation.adminUserIds.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      {nation.memberUserIds.length > 0 && (
                        <span className="flex items-center gap-1">
                          <UserPlus className="h-3 w-3" />
                          {nation.memberUserIds.length} member{nation.memberUserIds.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <span>{nation.isPublic ? 'Public' : 'Private'}</span>
                    </div>

                    {nation.description && (
                      <p className="mt-1 text-xs text-muted-foreground truncate max-w-xl">{nation.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(nation)} title="Edit">
                    <Settings2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setTransferNation(nation); setTransferUserId(''); }} title="Transfer Ownership">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => handleToggleActive(nation)}
                    disabled={toggling === nation.code}
                    title={nation.isActive ? 'Deactivate' : 'Activate'}
                  >
                    {toggling === nation.code ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : nation.isActive ? (
                      <PowerOff className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <Power className="h-3.5 w-3.5 text-emerald-600" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setDeleteNation(nation)}
                    disabled={nation._count.agents > 0}
                    title={nation._count.agents > 0 ? `Cannot delete — has ${nation._count.agents} agent(s)` : 'Delete Nation'}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Transfer Ownership Dialog */}
      <Dialog open={!!transferNation} onOpenChange={open => { if (!open) setTransferNation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer Ownership — {transferNation?.code}</DialogTitle>
            <DialogDescription>
              Transfer <strong>{transferNation?.displayName}</strong> to a different user.
              The current owner is <strong>{transferNation?.owner.name || transferNation?.owner.email}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label>New Owner</Label>
            <UserSearchPicker
              users={users}
              selectedId={transferUserId}
              onChange={setTransferUserId}
              excludeIds={transferNation ? [transferNation.ownerId] : []}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTransferNation(null)}>Cancel</Button>
            <Button onClick={handleTransfer} disabled={!transferUserId || transferring}>
              {transferring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ArrowRightLeft className="h-4 w-4 mr-2" />}
              Transfer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Nation Dialog */}
      <Dialog open={!!editNation} onOpenChange={open => { if (!open) setEditNation(null); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Nation — {editNation?.code}</DialogTitle>
            <DialogDescription>Update nation settings, type, and access controls.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* Avatar upload */}
            {editNation && (
              <div className="space-y-2">
                <Label>Avatar</Label>
                <div className="flex items-center gap-4">
                  <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center overflow-hidden border shrink-0">
                    {editNation.avatarUrl ? (
                      <img src={editNation.avatarUrl} alt={editNation.displayName} className="h-full w-full object-cover" />
                    ) : editNation.badge ? (
                      <span className="text-2xl">{editNation.badge}</span>
                    ) : (
                      <Globe className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="cursor-pointer">
                      <Button variant="outline" size="sm" asChild>
                        <span>
                          {uploadingAvatar === editNation.code ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Upload
                        </span>
                      </Button>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file && editNation) handleAvatarUpload(editNation.code, file);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    {editNation.avatarUrl && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleAvatarRemove(editNation.code)}>
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        Remove
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">Max 256 KB. JPEG, PNG, WebP, GIF.</p>
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={editData.displayName} onChange={e => setEditData(d => ({ ...d, displayName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={editData.description} onChange={e => setEditData(d => ({ ...d, description: e.target.value }))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={editData.type} onValueChange={v => setEditData(d => ({ ...d, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="org">Org</SelectItem>
                    <SelectItem value="carrier">Carrier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Visibility</Label>
                <Select value={editData.isPublic ? 'public' : 'private'} onValueChange={v => setEditData(d => ({ ...d, isPublic: v === 'public' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <UserPicker
              users={users}
              selectedIds={editData.adminUserIds}
              onChange={ids => setEditData(d => ({ ...d, adminUserIds: ids }))}
              label="Nation Admins"
              hint="(can manage settings, members, delegations)"
              excludeIds={editNation ? [editNation.ownerId] : []}
            />
            <UserPicker
              users={users}
              selectedIds={editData.memberUserIds}
              onChange={ids => setEditData(d => ({ ...d, memberUserIds: ids }))}
              label="Member Allowlist"
              hint="(empty = open to all authenticated users)"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditNation(null)}>Cancel</Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Nation Dialog */}
      <Dialog open={showCreate} onOpenChange={open => { if (!open) setShowCreate(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create Nation</DialogTitle>
            <DialogDescription>Create a new nation code. Admin-created nations skip credit costs and provisional periods.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Nation Code</Label>
                <Input
                  value={newNation.code}
                  onChange={e => setNewNation(d => ({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) }))}
                  placeholder="ABCD"
                  maxLength={4}
                  className="font-mono uppercase"
                />
                <p className="text-xs text-muted-foreground">Exactly 4 uppercase letters. Cannot be changed later.</p>
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={newNation.type} onValueChange={v => setNewNation(d => ({ ...d, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="org">Org</SelectItem>
                    <SelectItem value="carrier">Carrier</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Display Name</Label>
              <Input value={newNation.displayName} onChange={e => setNewNation(d => ({ ...d, displayName: e.target.value }))} placeholder="My Nation" />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Input value={newNation.description} onChange={e => setNewNation(d => ({ ...d, description: e.target.value }))} placeholder="A short description…" />
            </div>
            {/* Emoji picker */}
            <div className="space-y-2">
              <Label>Badge / Emoji <span className="text-muted-foreground font-normal">(optional — or upload an avatar after creation)</span></Label>
              <div className="flex flex-wrap gap-1.5">
                {['🌐', '🏢', '🏛️', '🚀', '⚡', '🛡️', '🔮', '🧬', '💎', '🌀', '🦊', '🐙', '🪼', '🤖', '🎯', '📡'].map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => setNewNation(d => ({ ...d, badge: d.badge === emoji ? '' : emoji }))}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-base transition-all ${
                      newNation.badge === emoji
                        ? 'bg-primary/20 ring-2 ring-primary scale-110'
                        : 'bg-muted hover:bg-muted/80'
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={newNation.badge}
                  onChange={e => setNewNation(d => ({ ...d, badge: e.target.value }))}
                  placeholder="Or type a custom emoji…"
                  maxLength={10}
                  className="h-9 w-48"
                />
                {newNation.badge && (
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <span className="text-lg">{newNation.badge}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select value={newNation.isPublic ? 'public' : 'private'} onValueChange={v => setNewNation(d => ({ ...d, isPublic: v === 'public' }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Owner</Label>
              <UserSearchPicker
                users={users}
                selectedId={newNation.ownerId}
                onChange={id => setNewNation(d => ({ ...d, ownerId: id }))}
              />
              <p className="text-xs text-muted-foreground">Leave blank to assign to yourself.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating || newNation.code.length !== 4 || !newNation.displayName}>
              {creating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Nation Dialog */}
      <Dialog open={!!deleteNation} onOpenChange={open => { if (!open) setDeleteNation(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Nation — {deleteNation?.code}</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deleteNation?.displayName}</strong> ({deleteNation?.code}) and all associated delegation certificates. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteNation && deleteNation._count.agents > 0 && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="py-3">
                <p className="text-sm text-destructive">
                  Cannot delete — this nation has {deleteNation._count.agents} agent(s). Deactivate it or remove agents first.
                </p>
              </CardContent>
            </Card>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteNation(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || (deleteNation?._count.agents ?? 0) > 0}
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Overview Tab ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════

function OverviewTab() {
  const [stats, setStats] = useState<{
    blocks: number;
    policies: number;
    agents: number;
    users: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/admin/carrier-blocks').then(r => r.json()),
      fetch('/api/admin/carrier-policies').then(r => r.json()),
      fetch('/api/agents?limit=1').then(r => r.json()),
    ]).then(([blocks, policies, agents]) => {
      setStats({
        blocks: Array.isArray(blocks) ? blocks.length : 0,
        policies: Array.isArray(policies) ? policies.length : 0,
        agents: agents?.total ?? agents?.agents?.length ?? 0,
        users: 0, // No public user count endpoint
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Ban className="h-4 w-4" /> Active Blocks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.blocks ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <ScrollText className="h-4 w-4" /> Active Policies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.policies ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Bot className="h-4 w-4" /> Agents
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-bold">{stats?.agents ?? '—'}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Users className="h-4 w-4" /> Carrier Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-sm font-medium">Operational</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Blocks Tab ───────────────────────────────────────────
// ══════════════════════════════════════════════════════════

function BlocksTab() {
  const [blocks, setBlocks] = useState<CarrierBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newBlock, setNewBlock] = useState({ type: 'agent_id', value: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  const fetchBlocks = useCallback(async () => {
    const res = await fetch('/api/admin/carrier-blocks');
    if (res.ok) setBlocks(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  async function handleCreate() {
    if (!newBlock.value.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/carrier-blocks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newBlock.type,
          value: newBlock.value.trim(),
          reason: newBlock.reason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewBlock({ type: 'agent_id', value: '', reason: '' });
        setShowCreate(false);
        fetchBlocks();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create block');
      }
    } catch {
      setError('Network error');
    }
    setCreating(false);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    await fetch(`/api/admin/carrier-blocks/${id}`, { method: 'DELETE' });
    fetchBlocks();
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Carrier Blocks</h2>
          <p className="text-sm text-muted-foreground">Block agents, numbers, nations, or IPs from the network</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchBlocks(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Block
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Block Type</Label>
                <Select value={newBlock.type} onValueChange={v => setNewBlock(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="agent_id">Agent ID</SelectItem>
                    <SelectItem value="molt_number_pattern">MoltNumber Pattern</SelectItem>
                    <SelectItem value="nation_code">Nation Code</SelectItem>
                    <SelectItem value="ip_address">IP Address</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value</Label>
                <Input
                  placeholder={newBlock.type === 'molt_number_pattern' ? 'EVIL-*' : newBlock.type === 'nation_code' ? 'EVIL' : 'value'}
                  value={newBlock.value}
                  onChange={e => setNewBlock(p => ({ ...p, value: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="Why this block?"
                  value={newBlock.reason}
                  onChange={e => setNewBlock(p => ({ ...p, reason: e.target.value }))}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating || !newBlock.value.trim()}>
                {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                Create Block
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : blocks.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Ban className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active carrier blocks</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {blocks.map(block => (
            <Card key={block.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="outline" className="shrink-0">
                    {BLOCK_TYPE_LABELS[block.type] || block.type}
                  </Badge>
                  <code className="text-sm font-mono truncate">{block.value}</code>
                  {block.reason && (
                    <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                      — {block.reason}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{timeAgo(block.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(block.id)}
                    disabled={deleting === block.id}
                  >
                    {deleting === block.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Policies Tab ─────────────────────────────────────────
// ══════════════════════════════════════════════════════════

function PoliciesTab() {
  const [policies, setPolicies] = useState<CarrierPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newPolicy, setNewPolicy] = useState({ type: 'require_verified_domain', value: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  const fetchPolicies = useCallback(async () => {
    const res = await fetch('/api/admin/carrier-policies');
    if (res.ok) setPolicies(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/carrier-policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newPolicy.type,
          value: newPolicy.value.trim() || undefined,
          reason: newPolicy.reason.trim() || undefined,
        }),
      });
      if (res.ok) {
        setNewPolicy({ type: 'require_verified_domain', value: '', reason: '' });
        setShowCreate(false);
        fetchPolicies();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to create policy');
      }
    } catch {
      setError('Network error');
    }
    setCreating(false);
  }

  async function handleDelete(type: string) {
    setDeleting(type);
    await fetch('/api/admin/carrier-policies', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type }),
    });
    fetchPolicies();
    setDeleting(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Carrier Policies</h2>
          <p className="text-sm text-muted-foreground">Trust requirements for inbound callers</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchPolicies(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add Policy
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>Policy Type</Label>
                <Select value={newPolicy.type} onValueChange={v => setNewPolicy(p => ({ ...p, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="require_verified_domain">Require Verified Domain</SelectItem>
                    <SelectItem value="require_social_verification">Require Social Verification</SelectItem>
                    <SelectItem value="minimum_age_hours">Minimum Account Age</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Value {newPolicy.type === 'minimum_age_hours' ? '(hours)' : '(optional)'}</Label>
                <Input
                  placeholder={newPolicy.type === 'minimum_age_hours' ? '24' : ''}
                  value={newPolicy.value}
                  onChange={e => setNewPolicy(p => ({ ...p, value: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>Reason (optional)</Label>
                <Input
                  placeholder="Why this policy?"
                  value={newPolicy.reason}
                  onChange={e => setNewPolicy(p => ({ ...p, reason: e.target.value }))}
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCreate} disabled={creating}>
                {creating ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                Create Policy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Policies apply to <strong>all inbound callers</strong>. Each type can only have one active instance — creating a new one replaces the old.
          </p>
        </CardContent>
      </Card>

      {/* List */}
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : policies.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <ScrollText className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No active carrier policies</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {policies.map(policy => (
            <Card key={policy.id}>
              <CardContent className="py-3 flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant="secondary" className="shrink-0">
                    {POLICY_TYPE_LABELS[policy.type] || policy.type}
                  </Badge>
                  {policy.value && (
                    <code className="text-sm font-mono">{policy.value}</code>
                  )}
                  {policy.reason && (
                    <span className="text-xs text-muted-foreground hidden sm:inline truncate">
                      — {policy.reason}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground">{timeAgo(policy.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(policy.type)}
                    disabled={deleting === policy.type}
                  >
                    {deleting === policy.type ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Credits Tab ──────────────────────────────────────────
// ══════════════════════════════════════════════════════════

function CreditsTab() {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [granting, setGranting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function handleGrant() {
    if (!userId.trim() || !amount) return;
    setGranting(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/credits/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId.trim(),
          amount: parseInt(amount, 10),
          description: description.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, message: `Granted ${data.granted.toLocaleString()} credits. New balance: ${data.balance.toLocaleString()}` });
        setUserId('');
        setAmount('');
        setDescription('');
      } else {
        setResult({ ok: false, message: data.error || 'Failed to grant credits' });
      }
    } catch {
      setResult({ ok: false, message: 'Network error' });
    }
    setGranting(false);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Grant Credits</h2>
        <p className="text-sm text-muted-foreground">Add MoltCredits to a user&apos;s balance</p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>User ID</Label>
              <Input
                placeholder="cuid..."
                value={userId}
                onChange={e => setUserId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input
                type="number"
                placeholder="10000"
                min={1}
                max={1000000}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Description (optional)</Label>
              <Input
                placeholder="Compensation, bonus, etc."
                value={description}
                onChange={e => setDescription(e.target.value)}
              />
            </div>
          </div>

          {result && (
            <div className={`flex items-center gap-2 text-sm ${result.ok ? 'text-emerald-600' : 'text-destructive'}`}>
              {result.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              {result.message}
            </div>
          )}

          <Button onClick={handleGrant} disabled={granting || !userId.trim() || !amount}>
            {granting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Coins className="h-4 w-4 mr-2" />}
            Grant Credits
          </Button>
        </CardContent>
      </Card>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="py-3 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Credit grants are recorded in the transaction ledger and cannot be undone. Use the refund API for corrections.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════
// ── Jobs Tab ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════════

const JOBS = [
  {
    id: 'nonce-cleanup',
    label: 'Nonce Cleanup',
    description: 'Prune expired nonces from the replay protection table',
    endpoint: '/api/admin/nonce-cleanup',
    resultKey: 'deleted',
  },
  {
    id: 'task-retry',
    label: 'Delivery Retry Worker',
    description: 'Process queued messages eligible for webhook retry',
    endpoint: '/api/admin/task-retry-worker',
    resultKey: 'processed',
  },
  {
    id: 'expire-proposals',
    label: 'Expire Proposals',
    description: 'Expire stale direct connection proposals (24h TTL)',
    endpoint: '/api/admin/expire-proposals',
    resultKey: 'expired',
  },
  {
    id: 'expire-unclaimed',
    label: 'Expire Unclaimed Agents',
    description: 'Deactivate unclaimed agents past their 7-day claim window',
    endpoint: '/api/admin/expire-unclaimed',
    resultKey: 'expired',
  },
  {
    id: 'task-cleanup',
    label: 'Message Cleanup',
    description: 'Delete completed/canceled/failed messages older than 30 days',
    endpoint: '/api/admin/task-cleanup',
    resultKey: 'deleted',
  },
  {
    id: 'expire-stale-calls',
    label: 'Expire Stale Calls',
    description: 'Cancel stuck ringing (>1h) and complete stuck in-progress (>30m) calls',
    endpoint: '/api/admin/expire-stale-calls',
    resultKey: 'ringingExpired',
  },
];

function JobsTab() {
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, CronResult>>({});

  async function runJob(job: typeof JOBS[0]) {
    setRunning(job.id);
    try {
      const start = Date.now();
      const res = await fetch(job.endpoint, { method: 'POST' });
      const elapsed = Date.now() - start;
      const data = await res.json();
      setResults(prev => ({
        ...prev,
        [job.id]: {
          label: job.label,
          count: data[job.resultKey] ?? data.processed ?? 0,
          time: `${elapsed}ms`,
          success: res.ok,
        },
      }));
    } catch {
      setResults(prev => ({
        ...prev,
        [job.id]: { label: job.label, count: 0, time: '—', success: false },
      }));
    }
    setRunning(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Cron Jobs</h2>
        <p className="text-sm text-muted-foreground">Run maintenance jobs manually. In production, these are triggered by your cron scheduler.</p>
      </div>

      <div className="space-y-2">
        {JOBS.map(job => {
          const result = results[job.id];
          return (
            <Card key={job.id}>
              <CardContent className="py-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{job.label}</span>
                    {result && (
                      <Badge variant={result.success ? 'secondary' : 'destructive'} className="text-xs">
                        {result.success ? `${result.count} processed` : 'Failed'} · {result.time}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{job.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => runJob(job)}
                  disabled={running !== null}
                >
                  {running === job.id ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Run
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 flex items-start gap-2">
          <Clock className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            <p><strong>Recommended cron schedule:</strong></p>
            <ul className="mt-1 space-y-0.5 ml-4 list-disc list-outside">
              <li>Nonce cleanup — every 10 minutes</li>
              <li>Delivery retry worker — every 1 minute</li>
              <li>Expire stale calls — every 5 minutes</li>
              <li>Expire proposals — every hour</li>
              <li>Expire unclaimed agents — daily</li>
              <li>Message cleanup — daily</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
