'use client';

import { useRef, useState, useCallback, KeyboardEvent, ClipboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Phone, Hash, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

const SEGMENT_COUNT = 5;
const SEGMENT_LENGTH = 4;

export function DialBar() {
  const router = useRouter();
  const [segments, setSegments] = useState<string[]>(Array(SEGMENT_COUNT).fill(''));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [allSelected, setAllSelected] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setRef = useCallback(
    (i: number) => (el: HTMLInputElement | null) => {
      refs.current[i] = el;
    },
    [],
  );

  const selectAll = (currentIndex?: number) => {
    setAllSelected(true);
    // Keep focus on current input
    if (currentIndex !== undefined) {
      refs.current[currentIndex]?.focus();
    }
  };

  const clearSelection = () => {
    if (allSelected) setAllSelected(false);
  };

  const update = (index: number, value: string) => {
    clearSelection();
    const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SEGMENT_LENGTH);
    setSegments(prev => {
      const next = [...prev];
      next[index] = cleaned;
      return next;
    });
    setError('');
    // Auto-advance when segment is full
    if (cleaned.length === SEGMENT_LENGTH && index < SEGMENT_COUNT - 1) {
      refs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    // Select all segments with Ctrl/Cmd+A
    if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      selectAll(index);
      return;
    }
    // Copy full assembled number with Ctrl/Cmd+C
    if (e.key === 'c' && (e.metaKey || e.ctrlKey)) {
      if (allSelected || segments.some(s => s.length > 0)) {
        e.preventDefault();
        navigator.clipboard.writeText(segments.join('-'));
      }
      return;
    }
    clearSelection();
    if (e.key === 'Backspace' && segments[index] === '' && index > 0) {
      refs.current[index - 1]?.focus();
    }
    if (e.key === 'Enter') {
      dial();
    }
    if (e.key === 'ArrowLeft' && index > 0) {
      const input = refs.current[index];
      if (input && input.selectionStart === 0) {
        e.preventDefault();
        refs.current[index - 1]?.focus();
      }
    }
    if (e.key === 'ArrowRight' && index < SEGMENT_COUNT - 1) {
      const input = refs.current[index];
      if (input && input.selectionStart === input.value.length) {
        e.preventDefault();
        refs.current[index + 1]?.focus();
      }
    }
  };

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text').toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Distribute pasted chars across segments
    const newSegments = Array(SEGMENT_COUNT).fill('');
    for (let i = 0; i < SEGMENT_COUNT; i++) {
      newSegments[i] = text.slice(i * SEGMENT_LENGTH, (i + 1) * SEGMENT_LENGTH);
    }
    setSegments(newSegments);
    setError('');
    // Focus appropriate segment
    const filledCount = newSegments.filter(s => s.length === SEGMENT_LENGTH).length;
    const focusIdx = Math.min(filledCount, SEGMENT_COUNT - 1);
    refs.current[focusIdx]?.focus();
  };

  const fullNumber = segments.join('-');
  const isComplete = segments.every(s => s.length === SEGMENT_LENGTH);

  const dial = async () => {
    if (!isComplete) {
      setError('Enter a complete MoltNumber');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/agents?moltNumber=${encodeURIComponent(fullNumber)}`);
      const data = await res.json();
      const agents = Array.isArray(data) ? data : [];
      const match = agents[0];
      if (match) {
        router.push(`/agents/${match.id}`);
        setSegments(Array(SEGMENT_COUNT).fill(''));
      } else {
        setError('MoltNumber not found');
      }
    } catch {
      setError('Lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const isEmpty = segments.every(s => s === '');

  return (
    <div className="flex min-w-0 max-w-full items-center">
      {/* Mobile: phone icon toggle */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 sm:hidden text-muted-foreground"
        onClick={() => { setExpanded(v => !v); setError(''); }}
        aria-label="Enter MoltNumber"
      >
        {expanded ? <X className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
      </Button>

      {/* Desktop: always visible / Mobile: toggle */}
      <form
        onSubmit={e => { e.preventDefault(); dial(); }}
        className={`relative min-w-0 max-w-full overflow-x-hidden items-center gap-1.5 ${expanded ? 'flex' : 'hidden sm:flex'}`}
      >
        {/* Hint label */}
        {isEmpty && (
          <span className="hidden xl:block mr-1 text-[10px] text-muted-foreground select-none whitespace-nowrap">
            Enter MoltNumber
          </span>
        )}

        <div className="flex min-w-0 items-center gap-1 rounded-lg px-1 py-0.5">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && (
                <span className="text-muted-foreground text-xs font-mono select-none">-</span>
              )}
              <input
                ref={setRef(i)}
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                autoComplete="off"
                maxLength={SEGMENT_LENGTH}
                value={seg}
                onChange={e => update(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onClick={clearSelection}
                placeholder={i === 0 ? 'MPHO' : '0000'}
                className={`
                  w-[2.6rem] sm:w-[2.8rem] h-7 text-center font-mono text-xs sm:text-sm text-foreground
                  rounded border border-primary
                  outline-none focus:ring-2 focus:ring-primary focus:border-primary
                  placeholder:text-muted-foreground
                  transition-all
                  ${allSelected && seg ? 'bg-primary/30' : 'bg-primary/10 focus:bg-primary/15'}
                `}
                aria-label={i === 0 ? 'Nation code' : `Segment ${i + 1}`}
              />
            </div>
          ))}
        </div>

        <Button
          type="submit"
          variant="ghost"
          size="icon"
          disabled={!isComplete || loading}
          className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10 shrink-0"
          aria-label="Dial"
          title="Enter MoltNumber"
        >
          <Phone className="h-3.5 w-3.5" />
        </Button>

        {error && <span className="hidden md:inline text-xs text-destructive whitespace-nowrap">{error}</span>}
      </form>
    </div>
  );
}
