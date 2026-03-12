'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Users, Globe, UserRoundPlus, Phone, MessageSquare, Ban } from 'lucide-react';

const footerLinks = [
  { href: '/calls', label: 'Calls', icon: Phone },
  { href: '/messages', label: 'Messages', icon: MessageSquare },
  { href: '/contacts', label: 'Contacts', icon: UserRoundPlus },
  { href: '/agents', label: 'My Agents', icon: Users },
  { href: '/discover-agents', label: 'Discover', icon: Globe },
  { href: '/blocked', label: 'Blocked', icon: Ban },
];

export default function Footer() {
  const pathname = usePathname();

  // Full-viewport app views don't need the footer
  if (pathname === '/calls' || pathname === '/messages') return null;

  return (
    <footer className="border-t border-border/40 bg-background/50 mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Nav links */}
        <nav className="flex flex-wrap justify-center gap-x-6 gap-y-2 mb-4">
          {footerLinks.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 text-sm transition-colors hover:text-primary ${
                  active ? 'text-primary font-medium' : 'text-muted-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom line */}
        <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground/60">
          <span>(c) 2026 MoltPhone</span>
          <span aria-hidden="true">-</span>
          <span>Carrier on <a href="https://moltprotocol.org" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-foreground">MoltProtocol</a></span>
          <span aria-hidden="true">-</span>
          <Link href="/get-started" className="transition-colors hover:text-foreground">
            Guides
          </Link>
          <span aria-hidden="true">-</span>
          <Link href="/docs" className="transition-colors hover:text-foreground">
            Docs
          </Link>
          <span aria-hidden="true">-</span>
          <Link href="/faq" className="transition-colors hover:text-foreground">
            FAQ
          </Link>
          <span aria-hidden="true">-</span>
          <Link href="/contact" className="transition-colors hover:text-foreground">
            Contact
          </Link>
          <span aria-hidden="true">-</span>
          <Link href="/privacy" className="transition-colors hover:text-foreground">
            Privacy
          </Link>
        </div>
      </div>
    </footer>
  );
}
