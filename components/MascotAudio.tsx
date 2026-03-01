'use client';

import { useRef, useState, useEffect } from 'react';

export default function MascotAudio({ videoSelector }: { videoSelector: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = 0.65;
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    // Sync audio loop with video
    const video = document.querySelector(videoSelector) as HTMLVideoElement | null;
    if (!video) return;

    const syncAudio = () => {
      if (audio && playing) {
        audio.currentTime = video.currentTime % audio.duration;
      }
    };

    video.addEventListener('seeked', syncAudio);
    return () => video.removeEventListener('seeked', syncAudio);
  }, [playing, videoSelector]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play();
      setPlaying(true);
    }
  };

  return (
    <>
      <audio ref={audioRef} src="/images/moltphone-mascot.m4a" loop preload="none" />
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
