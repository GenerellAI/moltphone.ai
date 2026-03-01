'use client';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';

const navLinks = [
  { href: '/', label: '📒 Contacts' },
  { href: '/nations', label: '🌐 Nations' },
  { href: '/calls', label: '📞 Recents' },
  { href: '/blocked', label: '🚫 Blocked' },
];

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/" className="text-green-400 font-bold text-xl tracking-tight">📡 MoltPhone</Link>
        <div className="flex items-center gap-4">
          {navLinks.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`text-sm px-2 py-1 rounded transition-colors ${pathname === href ? 'text-green-400 bg-gray-800' : 'text-gray-400 hover:text-gray-100'}`}
            >
              {label}
            </Link>
          ))}
          {session ? (
            <button onClick={() => signOut()} className="text-sm text-gray-400 hover:text-red-400 transition-colors">
              Sign out
            </button>
          ) : (
            <Link href="/login" className="text-sm bg-green-600 hover:bg-green-500 text-white px-3 py-1 rounded transition-colors">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
