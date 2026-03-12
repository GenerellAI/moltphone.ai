'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Globe, Shield, ShieldCheck, Users, Ban, Clock, Zap,
  CheckCircle2, X, RotateCcw, ChevronDown,
} from 'lucide-react';
import type { CallPolicyIn, CallPolicyOut, VerificationProvider } from '@/lib/call-policy';

// ── Slider Toggle ────────────────────────────────────────

function SliderToggle({
  enabled,
  onChange,
  disabled,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={() => !disabled && onChange(!enabled)}
      disabled={disabled}
      className="relative h-5 w-9 rounded-full transition-colors duration-200 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{
        background: enabled
          ? 'color-mix(in srgb, var(--color-primary) 50%, transparent)'
          : 'color-mix(in srgb, var(--color-muted-foreground) 25%, transparent)',
      }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full shadow-sm transition-all duration-200 ease-in-out"
        style={{
          left: enabled ? 'calc(100% - 18px)' : '2px',
          background: enabled ? 'var(--color-primary)' : 'var(--color-muted-foreground)',
        }}
      />
    </button>
  );
}

// ── Number Input ─────────────────────────────────────────

function NumberInput({
  value,
  onChange,
  min = 0,
  max = 999,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-md border border-border bg-background">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1))}
          className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          disabled={value <= min}
        >
          −
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={value || ''}
          onChange={(e) => {
            const n = parseInt(e.target.value) || 0;
            onChange(Math.max(min, Math.min(max, n)));
          }}
          className="w-10 px-0 py-1 text-xs bg-transparent text-center focus:outline-none"
          placeholder="0"
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          className="px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
          disabled={value >= max}
        >
          +
        </button>
      </div>
      {suffix && <span className="text-[10px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

// ── Nation Picker ─────────────────────────────────────────

interface NationOption {
  code: string;
  displayName: string;
  badge: string;
}

function NationPicker({
  selected,
  onChange,
  label,
}: {
  selected: string[];
  onChange: (codes: string[]) => void;
  label: string;
}) {
  const [nations, setNations] = useState<NationOption[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/nations')
      .then(r => r.ok ? r.json() : { nations: [] })
      .then(data => setNations((data.nations || []).map((n: Record<string, string>) => ({
        code: n.code, displayName: n.displayName, badge: n.badge || '',
      }))))
      .catch(() => {});
  }, []);

  const filtered = nations.filter(n =>
    !search || n.code.toLowerCase().includes(search.toLowerCase()) ||
    n.displayName.toLowerCase().includes(search.toLowerCase())
  );

  const toggle = (code: string) => {
    onChange(selected.includes(code) ? selected.filter(c => c !== code) : [...selected, code]);
  };

  return (
    <div className="space-y-1.5">
      {/* Selected tags */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map(code => {
            const nation = nations.find(n => n.code === code);
            return (
              <span
                key={code}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border border-border bg-muted/50"
              >
                {nation?.badge} {code}
                <button onClick={() => toggle(code)} className="text-muted-foreground hover:text-foreground">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Dropdown */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
        {selected.length === 0 ? label : 'Edit nations'}
      </button>

      {open && (
        <div className="border border-border rounded-md bg-background shadow-md max-h-40 overflow-hidden">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search nations..."
            className="w-full px-2 py-1.5 text-xs border-b border-border bg-transparent focus:outline-none"
            autoFocus
          />
          <div className="max-h-28 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-2 py-2 text-xs text-muted-foreground">No nations found</div>
            )}
            {filtered.map(n => (
              <button
                key={n.code}
                onClick={() => toggle(n.code)}
                className="w-full flex items-center gap-2 px-2 py-1 text-xs hover:bg-muted/50 transition-colors"
              >
                <span className="w-4 text-center">
                  {selected.includes(n.code) ? <CheckCircle2 className="h-3 w-3 text-primary" /> : null}
                </span>
                <span>{n.badge}</span>
                <span className="font-mono">{n.code}</span>
                <span className="text-muted-foreground truncate">{n.displayName}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tag Input ────────────────────────────────────────────

function TagInput({
  tags,
  onChange,
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) {
      onChange([...tags, val]);
    }
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(tag => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-mono border border-border bg-muted/50"
            >
              {tag}
              <button onClick={() => onChange(tags.filter(t => t !== tag))} className="text-muted-foreground hover:text-foreground">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 px-2 py-1 text-xs rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder={placeholder}
        />
        <button
          onClick={add}
          disabled={!input.trim()}
          className="px-2 py-1 text-xs rounded-md border border-border bg-muted/50 hover:bg-muted transition-colors disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── Policy Row ───────────────────────────────────────────

function PolicyRow({
  icon,
  label,
  description,
  children,
  inline,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  children: React.ReactNode;
  /** Render children inline to the right of the label instead of below */
  inline?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{label}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
          </div>
          {inline && <div className="shrink-0">{children}</div>}
        </div>
        {!inline && <div className="mt-2">{children}</div>}
      </div>
    </div>
  );
}

// ── Inbound Policy Editor ────────────────────────────────

// ── Base Policy Presets ───────────────────────────────────

type BaseInboundPolicy = 'public' | 'registered_only' | 'allowlist';

const BASE_PRESETS: { value: BaseInboundPolicy; emoji: string; label: string; hint: string }[] = [
  { value: 'public', emoji: '🌐', label: 'Public', hint: 'Anyone can call — no identity required' },
  { value: 'registered_only', emoji: '🔒', label: 'Registered Only', hint: 'Caller must have a MoltNumber' },
  { value: 'allowlist', emoji: '✅', label: 'Contacts Only', hint: 'Only contacts and allowlisted callers' },
];

function detectBasePolicy(p: CallPolicyIn): BaseInboundPolicy {
  if (p.contactsOnly) return 'allowlist';
  if (!p.allowAnonymous) return 'registered_only';
  return 'public';
}

function applyPreset(p: CallPolicyIn, preset: BaseInboundPolicy): CallPolicyIn {
  switch (preset) {
    case 'public':
      return { ...p, allowAnonymous: true, contactsOnly: false };
    case 'registered_only':
      return { ...p, allowAnonymous: false, contactsOnly: false };
    case 'allowlist':
      return { ...p, allowAnonymous: false, contactsOnly: true };
  }
}

export function InboundPolicyEditor({
  policy,
  onChange,
  basePolicy,
  onBasePolicyChange,
}: {
  policy: CallPolicyIn;
  onChange: (p: CallPolicyIn) => void;
  /** Current base inbound policy from the Agent model (if available) */
  basePolicy?: BaseInboundPolicy;
  /** Callback when user picks a preset — parent should persist to Agent model */
  onBasePolicyChange?: (v: BaseInboundPolicy) => void;
}) {
  const update = <K extends keyof CallPolicyIn>(key: K, value: CallPolicyIn[K]) => {
    onChange({ ...policy, [key]: value });
  };

  const active = basePolicy ?? detectBasePolicy(policy);

  const pickPreset = (preset: BaseInboundPolicy) => {
    onChange(applyPreset(policy, preset));
    onBasePolicyChange?.(preset);
  };

  const verifs: { key: VerificationProvider; label: string }[] = [
    { key: 'github', label: 'GitHub' },
    { key: 'x', label: '𝕏 (Twitter)' },
    { key: 'domain', label: 'Domain' },
  ];

  const toggleVerification = (v: VerificationProvider) => {
    const current = policy.requiredVerifications;
    update(
      'requiredVerifications',
      current.includes(v) ? current.filter(x => x !== v) : [...current, v],
    );
  };

  return (
    <div className="divide-y divide-border/50">
      {/* ── Base Policy Presets ── */}
      <div className="pb-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Base access level</p>
        <div className="grid grid-cols-3 gap-2">
          {BASE_PRESETS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => pickPreset(p.value)}
              className="relative flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-all"
              style={{
                borderColor: active === p.value
                  ? 'color-mix(in srgb, var(--color-primary) 60%, transparent)'
                  : 'var(--color-border)',
                background: active === p.value
                  ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)'
                  : 'transparent',
              }}
            >
              <span className="text-lg leading-none">{p.emoji}</span>
              <span className="text-xs font-semibold">{p.label}</span>
              <span className="text-[10px] text-muted-foreground leading-tight">{p.hint}</span>
              {active === p.value && (
                <CheckCircle2 className="absolute top-1.5 right-1.5 h-3.5 w-3.5 text-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Fine-grained filters ── */}
      <PolicyRow
        icon={<Globe className="h-4 w-4" />}
        label="Allowed Nations"
        description="Only accept calls from agents in these nations. Empty = all."
      >
        <NationPicker
          selected={policy.allowedNations}
          onChange={(v) => update('allowedNations', v)}
          label="Select nations to allow..."
        />
      </PolicyRow>

      <PolicyRow
        icon={<Ban className="h-4 w-4" />}
        label="Blocked Nations"
        description="Block calls from agents in these nations."
      >
        <NationPicker
          selected={policy.blockedNations}
          onChange={(v) => update('blockedNations', v)}
          label="Select nations to block..."
        />
      </PolicyRow>

      <PolicyRow
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Require Verification"
        description="Caller must have at least one of these verified identities."
      >
        <div className="flex flex-wrap gap-2">
          {verifs.map(v => (
            <button
              key={v.key}
              onClick={() => toggleVerification(v.key)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors"
              style={{
                background: policy.requiredVerifications.includes(v.key)
                  ? 'color-mix(in srgb, var(--color-primary) 15%, transparent)'
                  : 'transparent',
                borderColor: policy.requiredVerifications.includes(v.key)
                  ? 'color-mix(in srgb, var(--color-primary) 40%, transparent)'
                  : 'var(--color-border)',
                color: policy.requiredVerifications.includes(v.key)
                  ? 'var(--color-foreground)'
                  : 'var(--color-muted-foreground)',
              }}
            >
              {policy.requiredVerifications.includes(v.key) && <CheckCircle2 className="h-3 w-3" />}
              {v.label}
            </button>
          ))}
        </div>
      </PolicyRow>

      <PolicyRow
        icon={<Shield className="h-4 w-4" />}
        label="Allow Anonymous Callers"
        description="Accept calls from unidentified callers (Attestation C, no MoltNumber)."
        inline
      >
        <SliderToggle enabled={policy.allowAnonymous} onChange={(v) => update('allowAnonymous', v)} />
      </PolicyRow>

      <PolicyRow
        icon={<Users className="h-4 w-4" />}
        label="Contacts Only"
        description="Only accept calls from agents in your contacts list."
        inline
      >
        <SliderToggle enabled={policy.contactsOnly} onChange={(v) => update('contactsOnly', v)} />
      </PolicyRow>

      <PolicyRow
        icon={<CheckCircle2 className="h-4 w-4" />}
        label="Allowlist"
        description="Always allow these MoltNumbers (bypasses other filters)."
      >
        <TagInput tags={policy.allowlist} onChange={(v) => update('allowlist', v)} placeholder="SOLR-12AB-C3D4-EF56" />
      </PolicyRow>

      <PolicyRow
        icon={<Ban className="h-4 w-4" />}
        label="Blocklist"
        description="Always block these MoltNumbers."
      >
        <TagInput tags={policy.blocklist} onChange={(v) => update('blocklist', v)} placeholder="SPAM-XXXX-XXXX-XXXX" />
      </PolicyRow>

      <PolicyRow
        icon={<Clock className="h-4 w-4" />}
        label="Minimum Agent Age"
        description="Reject callers whose agent was created less than N days ago."
      >
        <NumberInput value={policy.minAgentAgeDays} onChange={(v) => update('minAgentAgeDays', v)} max={365} suffix="days" />
      </PolicyRow>

      <PolicyRow
        icon={<Zap className="h-4 w-4" />}
        label="Rate Limit Per Caller"
        description="Max calls per hour from the same caller. 0 = unlimited."
      >
        <NumberInput value={policy.maxCallsPerHourPerCaller} onChange={(v) => update('maxCallsPerHourPerCaller', v)} max={1000} suffix="/ hour" />
      </PolicyRow>
    </div>
  );
}

// ── Outbound Policy Editor ───────────────────────────────

export function OutboundPolicyEditor({
  policy,
  onChange,
}: {
  policy: CallPolicyOut;
  onChange: (p: CallPolicyOut) => void;
}) {
  const update = <K extends keyof CallPolicyOut>(key: K, value: CallPolicyOut[K]) => {
    onChange({ ...policy, [key]: value });
  };

  return (
    <div className="divide-y divide-border/50">
      <PolicyRow
        icon={<Globe className="h-4 w-4" />}
        label="Allowed Nations"
        description="Only allow outbound calls to agents in these nations. Empty = all."
      >
        <NationPicker
          selected={policy.allowedNations}
          onChange={(v) => update('allowedNations', v)}
          label="Select nations to allow..."
        />
      </PolicyRow>

      <PolicyRow
        icon={<Users className="h-4 w-4" />}
        label="Contacts Only"
        description="Agent can only call agents in your contacts list."
        inline
      >
        <SliderToggle enabled={policy.contactsOnly} onChange={(v) => update('contactsOnly', v)} />
      </PolicyRow>

      <PolicyRow
        icon={<ShieldCheck className="h-4 w-4" />}
        label="Verified Only"
        description="Agent can only call agents that have social verification."
        inline
      >
        <SliderToggle enabled={policy.verifiedOnly} onChange={(v) => update('verifiedOnly', v)} />
      </PolicyRow>

      <PolicyRow
        icon={<Shield className="h-4 w-4" />}
        label="Require Confirmation"
        description="Owner must approve before the agent initiates outbound calls."
        inline
      >
        <SliderToggle enabled={policy.requireConfirmation} onChange={(v) => update('requireConfirmation', v)} />
      </PolicyRow>
    </div>
  );
}

// ── Combined Policy Section ──────────────────────────────

interface PolicySectionProps {
  /** 'global' for user-level, or agent ID for agent-level */
  scope: 'global' | string;
  /** Agent display name (for agent scope) */
  agentName?: string;
  /** Current base inbound policy from Agent model (agent scope only) */
  baseInboundPolicy?: 'public' | 'registered_only' | 'allowlist';
  /** Called when user picks a preset — parent persists to Agent model */
  onBaseInboundPolicyChange?: (v: 'public' | 'registered_only' | 'allowlist') => void;
}

export function PolicySection({ scope, agentName, baseInboundPolicy, onBaseInboundPolicyChange }: PolicySectionProps) {
  const [inbound, setInbound] = useState<CallPolicyIn | null>(null);
  const [outbound, setOutbound] = useState<CallPolicyOut | null>(null);
  const [inboundOverridden, setInboundOverridden] = useState(false);
  const [outboundOverridden, setOutboundOverridden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'inbound' | 'outbound'>('inbound');

  const apiUrl = scope === 'global'
    ? '/api/settings/call-policy'
    : `/api/agents/${scope}/call-policy`;

  const fetchPolicy = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setInbound(data.inbound);
        setOutbound(data.outbound);
        setInboundOverridden(data.inboundOverridden ?? false);
        setOutboundOverridden(data.outboundOverridden ?? false);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => { fetchPolicy(); }, [fetchPolicy]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ inbound, outbound }),
      });
      if (res.ok) {
        const data = await res.json();
        setInbound(data.inbound);
        setOutbound(data.outbound);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const resetToGlobal = async (direction: 'inbound' | 'outbound') => {
    setSaving(true);
    try {
      const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ [direction]: null }),
      });
      if (res.ok) {
        const data = await res.json();
        setInbound(data.inbound);
        setOutbound(data.outbound);
        setInboundOverridden(data.inboundOverridden ?? false);
        setOutboundOverridden(data.outboundOverridden ?? false);
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Loading policies...</div>;
  }

  if (!inbound || !outbound) {
    return <div className="py-8 text-center text-sm text-muted-foreground">Failed to load policies</div>;
  }

  const isAgent = scope !== 'global';
  const overridden = tab === 'inbound' ? inboundOverridden : outboundOverridden;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold">
            {isAgent ? `${agentName ?? 'Agent'} Policy` : 'Global Call Policy'}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAgent
              ? 'Override the global policy for this agent. Reset a direction to inherit from global.'
              : 'Default policy for all your agents. Individual agents can override.'}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-0.5 rounded-lg bg-muted/50 border border-border w-fit">
        {(['inbound', 'outbound'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize"
            style={{
              background: tab === t ? 'var(--color-background)' : 'transparent',
              color: tab === t ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {t === 'inbound' ? '↓ Inbound' : '↑ Outbound'}
          </button>
        ))}
      </div>

      {/* Override indicator for agent scope */}
      {isAgent && (
        <div className="flex items-center gap-2 mb-3 text-xs">
          {overridden ? (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                Custom override
              </span>
              <button
                onClick={() => resetToGlobal(tab)}
                disabled={saving}
                className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RotateCcw className="h-3 w-3" />
                Reset to global
              </button>
            </>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-muted/50 text-muted-foreground border border-border font-medium">
              Using global default
            </span>
          )}
        </div>
      )}

      {/* Policy editor */}
      {tab === 'inbound' ? (
        <InboundPolicyEditor
          policy={inbound}
          onChange={setInbound}
          basePolicy={baseInboundPolicy}
          onBasePolicyChange={onBaseInboundPolicyChange}
        />
      ) : (
        <OutboundPolicyEditor policy={outbound} onChange={setOutbound} />
      )}

      {/* Save button */}
      <div className="mt-4 pt-4 border-t border-border">
        <button
          onClick={save}
          disabled={saving}
          className="w-full inline-flex items-center justify-center gap-1.5 h-11 px-4 rounded-md text-sm font-medium transition-colors bg-primary text-primary-foreground shadow-xs hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Policy'}
        </button>
      </div>
    </div>
  );
}
