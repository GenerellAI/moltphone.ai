'use client';

import { usePathname } from 'next/navigation';

/**
 * Wrapper around <main> that narrows non-landing pages so the
 * sidebar overlay doesn't cover content on smaller laptops.
 *
 * Landing page keeps max-w-6xl (1152 px) for its full-width hero;
 * all other pages use max-w-5xl (1024 px) which on a 1440 px
 * viewport leaves ~208 px each side — enough to clear the 192 px sidebar.
 */
export function PageMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === '/';
  const isFullViewport = pathname === '/calls' || pathname === '/messages';

  return (
    <main
      className={`${isLanding ? 'max-w-6xl' : 'max-w-5xl'} mx-auto px-4 sm:px-6 ${isFullViewport ? 'py-3' : 'py-8'} w-full flex-1 overflow-x-hidden${isFullViewport ? ' overflow-y-hidden' : ''}`}
    >
      {children}
    </main>
  );
}
