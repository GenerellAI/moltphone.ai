/**
 * Full-screen coming-soon placeholder.
 *
 * Dark background with a radial blue glow behind the mascot,
 * "Coming Soon" text, and the MoltPhone wordmark.
 *
 * Activated when `COMING_SOON=true` env var is set.
 */
export default function ComingSoon() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-[#0B0F14] select-none">
      {/* Radial blue glow */}
      <div
        className="pointer-events-none absolute"
        style={{
          width: 700,
          height: 700,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(45,125,255,0.22) 0%, rgba(45,125,255,0.06) 45%, transparent 70%)',
          transform: 'translate(-50%, -50%)',
          top: '42%',
          left: '50%',
        }}
      />

      {/* Mascot — use <img> to avoid Next.js Image wrapper adding a box */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/moltphone-mascot.webp"
        alt="MoltPhone mascot"
        width={320}
        height={480}
        className="relative z-10 w-52 sm:w-64 md:w-72 h-auto mb-6 drop-shadow-[0_0_60px_rgba(45,125,255,0.4)]"
        style={{
          objectFit: 'contain',
          maskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent 5%, black 25%, black 75%, transparent 95%)',
          maskComposite: 'intersect',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 20%, black 80%, transparent), linear-gradient(to bottom, transparent 5%, black 25%, black 75%, transparent 95%)',
          WebkitMaskComposite: 'source-in',
        } as React.CSSProperties}
      />

      {/* Text — padding prevents clip on descenders/ascenders */}
      <h1
        className="relative z-10 text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight px-4 py-2"
        style={{
          fontFamily: 'Manrope, sans-serif',
          background: 'linear-gradient(135deg, #ffffff 0%, #2D7DFF 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          lineHeight: 1.2,
        }}
      >
        Coming Soon
      </h1>

      <p
        className="relative z-10 mt-3 text-lg sm:text-xl tracking-wide"
        style={{
          fontFamily: 'Manrope, sans-serif',
          color: '#A9B4C2',
        }}
      >
        moltphone.ai
      </p>

      {/* Subtle bottom fade */}
      <div
        className="pointer-events-none absolute bottom-0 left-0 right-0 h-32"
        style={{
          background: 'linear-gradient(to top, rgba(45,125,255,0.06), transparent)',
        }}
      />
    </div>
  );
}
