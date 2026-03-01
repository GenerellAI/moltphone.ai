'use client';

import { useRef, useState, useEffect } from 'react';

export default function MascotAudio() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = 0.65;

    const onEnded = () => setPlaying(false);
    audio.addEventListener('ended', onEnded);

    // Attempt autoplay — browser may block it
    audio.play().then(() => {
      setPlaying(true);
    }).catch(() => {
      setAutoplayBlocked(true);
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
      setAutoplayBlocked(false);
    }
  };

  return (
    <>
      <audio ref={audioRef} src="/images/moltphone-mascot.m4a" preload="auto" />
      <button
        onClick={toggle}
        aria-label={playing ? 'Mute mascot sound' : 'Play mascot sound'}
        title={playing ? 'Mute' : 'Sound on'}
        className="absolute bottom-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-black/40 backdrop-blur-sm text-white/70 hover:text-white hover:bg-black/60 transition-all text-sm"
      >
        {playing ? '🔊' : '🔇'}
      </button>
    </>
  );
}
