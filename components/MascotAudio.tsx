'use client';

import { useRef, useState, useEffect } from 'react';

export default function MascotAudio() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.65;

    const onEnded = () => setPlaying(false);
    audio.addEventListener('ended', onEnded);

    // Attempt autoplay
    audio.play().then(() => {
      setPlaying(true);
      setHasPlayed(true);
    }).catch(() => {
      // Blocked — user can tap the button
    });

    return () => audio.removeEventListener('ended', onEnded);
  }, []);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.currentTime = 0;
      audio.play();
      setPlaying(true);
      setHasPlayed(true);
    }
  };

  return (
    <>
      <audio ref={audioRef} src="/images/moltphone-mascot.m4a" preload="auto" />
      <button
        onClick={toggle}
        aria-label={playing ? 'Mute mascot sound' : 'Play mascot sound'}
        className={`
          group relative flex items-center gap-2 px-4 py-2 rounded-full
          text-sm font-medium transition-all duration-300
          ${playing
            ? 'bg-brand/20 text-brand border border-brand/30'
            : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10 hover:text-white/90 hover:border-white/20'
          }
          backdrop-blur-md
        `}
      >
        {playing ? (
          <>
            <span className="flex items-end gap-[2px] h-3">
              <span className="w-[3px] bg-brand rounded-full animate-[bar1_0.8s_ease-in-out_infinite]" />
              <span className="w-[3px] bg-brand rounded-full animate-[bar2_0.8s_ease-in-out_infinite_0.2s]" />
              <span className="w-[3px] bg-brand rounded-full animate-[bar3_0.8s_ease-in-out_infinite_0.4s]" />
              <span className="w-[3px] bg-brand rounded-full animate-[bar4_0.8s_ease-in-out_infinite_0.1s]" />
            </span>
            <span>Playing&hellip;</span>
          </>
        ) : (
          <>
            {!hasPlayed && <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand rounded-full animate-ping" />}
            <span>🪼</span>
            <span>{hasPlayed ? 'Play again' : 'Say hi to Molt'}</span>
          </>
        )}
      </button>
    </>
  );
}
