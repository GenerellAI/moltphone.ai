'use client';

import { useStatus, type UserStatus } from '@/components/StatusProvider';

const states: { key: UserStatus; color: string; label: string }[] = [
  { key: 'available', color: '#22c55e', label: 'Available' },
  { key: 'dnd',       color: '#f59e0b', label: 'DND' },
  { key: 'off',       color: 'hsl(var(--muted-foreground) / 0.4)', label: 'Offline' },
];

/**
 * StatusPill — 3-state segmented control: On / DND / Off.
 * Matches the per-agent card selector.
 */
export function StatusPill() {
  const { status, setStatus } = useStatus();

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border/60 bg-background/80 backdrop-blur-sm px-1 py-0.5 select-none"
    >
      {states.map(s => (
        <button
          key={s.key}
          title={s.label}
          onClick={() => setStatus(s.key)}
          className="relative h-4 min-w-[22px] px-1 rounded-full text-[8px] font-bold tracking-wide transition-all duration-150 cursor-pointer"
          style={{
            background: status === s.key ? s.color : 'transparent',
            color: status === s.key ? '#fff' : s.color,
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
