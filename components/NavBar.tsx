'use client';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useTheme } from './ThemeProvider';

const navLinks = [
  { href: '/', label: 'Contacts' },
  { href: '/nations', label: 'Nations' },
  { href: '/calls', label: 'Recents' },
  { href: '/blocked', label: 'Blocked' },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      aria-label="Toggle theme"
      className="p-2 rounded-xl transition-all duration-150 hover:bg-[var(--color-brand-faint)]"
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-muted)]">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      )}
    </button>
  );
}

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b backdrop-blur-md" style={{ background: 'color-mix(in srgb, var(--color-bg) 85%, transparent)', borderColor: 'var(--color-border)' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-2xl" role="img" aria-label="jellyfish">🪼</span>
          <span className="font-bold text-lg tracking-tight" style={{ color: 'var(--color-brand)' }}>
            MoltPhone
          </span>
        </Link>

        {/* Nav links */}
        <div className="flex items-center gap-1">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`text-sm px-3 py-1.5 rounded-xl transition-all duration-150 ${
                  active
                    ? 'font-medium'
                    : 'hover:bg-[var(--color-brand-faint)]'
                }`}
                style={active ? { background: 'var(--color-brand-faint)', color: 'var(--color-brand)' } : { color: 'var(--color-text-muted)' }}
              >
                {label}
              </Link>
            );
          })}

          <div className="w-px h-5 mx-2" style={{ background: 'var(--color-border)' }} />

          <ThemeToggle />

          {session ? (
            <button
              onClick={() => signOut()}
              className="text-sm px-3 py-1.5 rounded-xl transition-all duration-150"
              style={{ color: 'var(--color-text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--color-danger)')}
              onMouseLeave={e => (e.currentTarget.style.color = 'var(--color-text-muted)')}
            >
              Sign out
            </button>
          ) : (
            <Link href="/login" className="btn-primary text-sm !px-4 !py-1.5">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
