'use client';

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useStatus } from '@/components/StatusProvider';

/* ─────────────────────────────────────────────────────────────────────────────
 * SoundProvider — global audio context for the entire app.
 *
 * • Creates a single shared AudioContext.
 * • Auto-unlocks it on the users first pointerdown / keydown (browser policy).
 * • Provides playRingTone() / stopRingTone()  — dual-tone 440+480 Hz ringback.
 * • Provides playMessageTick()                — subtle soft click on new message.
 * • Exposes a soundEnabled toggle persisted in localStorage.
 * ───────────────────────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'molt-sound-enabled';

interface SoundContextValue {
  /** User preference — persisted in localStorage */
  soundEnabled: boolean;
  setSoundEnabled: (v: boolean) => void;

  /** Play the dual-tone ringback (loops every ~3 s). Respects soundEnabled. */
  playRingTone: () => void;
  /** Stop the ring tone immediately. */
  stopRingTone: () => void;

  /** Short soft click for new incoming messages. Respects soundEnabled. */
  playMessageTick: () => void;
}

const SoundContext = createContext<SoundContextValue>({
  soundEnabled: true,
  setSoundEnabled: () => {},
  playRingTone: () => {},
  stopRingTone: () => {},
  playMessageTick: () => {},
});

export function useSound() {
  return useContext(SoundContext);
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [soundEnabled, setSoundEnabledRaw] = useState(true);
  const ctxRef = useRef<AudioContext | null>(null);
  const ringRef = useRef<{ gain: GainNode; oscs: OscillatorNode[]; interval: ReturnType<typeof setInterval> | null } | null>(null);
  const { status } = useStatus();

  // ── Hydrate from localStorage ──
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'false') setSoundEnabledRaw(false);
    } catch { /* SSR / unavailable */ }
  }, []);

  // ── Auto-mute when DND is activated ──
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'dnd' && status === 'dnd') {
      setSoundEnabledRaw(false);
      try { localStorage.setItem(STORAGE_KEY, 'false'); } catch { /* */ }
    }
    prevStatusRef.current = status;
  }, [status]);

  const setSoundEnabled = useCallback((v: boolean) => {
    setSoundEnabledRaw(v);
    try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* */ }
  }, []);

  // ── Ensure AudioContext exists, create lazily ──
  const ensureCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }, []);

  // ── Unlock AudioContext on first user gesture ──
  useEffect(() => {
    const unlock = () => {
      ensureCtx();
      // Remove listeners after first unlock
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    return () => {
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
  }, [ensureCtx]);

  // ── Stop ring tone ──
  const stopRingTone = useCallback(() => {
    const nodes = ringRef.current;
    if (!nodes) return;
    try {
      if (nodes.interval) clearInterval(nodes.interval);
      const t = nodes.gain.context.currentTime;
      nodes.gain.gain.cancelScheduledValues(t);
      nodes.gain.gain.setValueAtTime(nodes.gain.gain.value, t);
      nodes.gain.gain.linearRampToValueAtTime(0, t + 0.08);
      nodes.oscs.forEach(o => o.stop(t + 0.12));
    } catch { /* already stopped */ }
    ringRef.current = null;
  }, []);

  // ── Play looping ring tone (440 + 480 Hz, 2 s on / 4 s off) ──
  const playRingTone = useCallback(() => {
    if (!soundEnabled) return;
    stopRingTone();
    try {
      const ctx = ensureCtx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0, ctx.currentTime);

      const oscs = [440, 480].map(f => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        o.connect(gain);
        o.start();
        return o;
      });

      // Schedule one burst immediately, then repeat via setInterval
      const volume = 0.12;
      const scheduleRing = () => {
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(volume, now + 0.03);
        gain.gain.setValueAtTime(volume, now + 2.0);
        gain.gain.linearRampToValueAtTime(0, now + 2.05);
      };
      scheduleRing();
      const interval = setInterval(scheduleRing, 6000); // 2 s ring + 4 s silence

      ringRef.current = { gain, oscs, interval };
    } catch { /* Web Audio unavailable */ }
  }, [soundEnabled, ensureCtx, stopRingTone]);

  // ── Message notification chime (tri-tone ascending, like iMessage) ──
  const playMessageTick = useCallback(() => {
    if (!soundEnabled) return;
    try {
      const ctx = ensureCtx();
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;

      // Soft two-note "hollow knock" — warm, low, unobtrusive
      const notes = [
        { freq: 392, start: 0,    dur: 0.22 },  // G4 — mellow root
        { freq: 523, start: 0.18, dur: 0.30 },  // C5 — gentle fifth above
      ];

      notes.forEach(({ freq, start, dur }) => {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';            // softer timbre than sine
        osc.frequency.value = freq;

        const gain = ctx.createGain();
        // Gentle fade-in → slow decay (no hard attack)
        gain.gain.setValueAtTime(0.001, now + start);
        gain.gain.linearRampToValueAtTime(0.28, now + start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + dur + 0.02);
      });
    } catch { /* Web Audio unavailable */ }
  }, [soundEnabled, ensureCtx]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      stopRingTone();
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, [stopRingTone]);

  return (
    <SoundContext.Provider value={{ soundEnabled, setSoundEnabled, playRingTone, stopRingTone, playMessageTick }}>
      {children}
    </SoundContext.Provider>
  );
}
