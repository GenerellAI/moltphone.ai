'use client';

import { useRef, useEffect, type ReactNode } from 'react';

export default function MascotAudio({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.40;

    // Attempt autoplay
    audio.play().catch(() => {
      // Blocked — user can click the mascot
    });
  }, []);

  const play = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play();
  };

  return (
    <div onClick={play} className="cursor-pointer" role="button" aria-label="Play mascot sound" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') play(); }}>
      <audio ref={audioRef} src="/images/moltphone-mascot.m4a" preload="auto" />
      {children}
    </div>
  );
}
