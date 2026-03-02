'use client';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useTheme } from './ThemeProvider';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { Menu, Sun, Moon, LogOut, LogIn, Phone, Users, Globe, Star, Clock, Ban } from 'lucide-react';

const navLinks = [
  { href: '/', label: 'Contacts', icon: Phone },
  { href: '/agents', label: 'My Agents', icon: Users },
  { href: '/nations', label: 'Nations', icon: Globe },
  { href: '/favorites', label: 'Favorites', icon: Star },
  { href: '/calls', label: 'Recents', icon: Clock },
  { href: '/blocked', label: 'Blocked', icon: Ban },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggle}
      aria-label="Toggle theme"
      className="h-8 w-8"
    >
      {theme === 'dark' ? (
        <Sun className="h-4 w-4 text-muted-foreground" />
      ) : (
        <Moon className="h-4 w-4 text-muted-foreground" />
      )}
    </Button>
  );
}

export default function NavBar() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 group">
          <span className="text-2xl" role="img" aria-label="jellyfish">🪼</span>
          <span className="font-bold text-lg tracking-tight text-primary">
            MoltPhone
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-1">
          {navLinks.map(({ href, label }) => {
            const active = pathname === href;
            return (
              <Link key={href} href={href}>
                <Button
                  variant={active ? 'secondary' : 'ghost'}
                  size="sm"
                  className={active ? 'text-primary font-medium' : 'text-muted-foreground'}
                >
                  {label}
                </Button>
              </Link>
            );
          })}

          <Separator orientation="vertical" className="mx-2 h-5" />
          <ThemeToggle />

          {session ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut()}
              className="text-muted-foreground hover:text-destructive"
            >
              <LogOut className="h-4 w-4 mr-1" />
              Sign out
            </Button>
          ) : (
            <Link href="/login">
              <Button size="sm" className="ml-1">
                <LogIn className="h-4 w-4 mr-1" />
                Sign in
              </Button>
            </Link>
          )}
        </div>

        {/* Mobile hamburger */}
        <div className="flex md:hidden items-center gap-2">
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64">
              <SheetTitle className="text-primary font-bold flex items-center gap-2">
                <span>🪼</span> MoltPhone
              </SheetTitle>
              <nav className="flex flex-col gap-1 mt-6">
                {navLinks.map(({ href, label, icon: Icon }) => {
                  const active = pathname === href;
                  return (
                    <Link key={href} href={href} onClick={() => setOpen(false)}>
                      <Button
                        variant={active ? 'secondary' : 'ghost'}
                        className={`w-full justify-start ${active ? 'text-primary' : 'text-muted-foreground'}`}
                      >
                        <Icon className="h-4 w-4 mr-2" />
                        {label}
                      </Button>
                    </Link>
                  );
                })}
              </nav>
              <Separator className="my-4" />
              {session ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-muted-foreground hover:text-destructive"
                  onClick={() => { signOut(); setOpen(false); }}
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </Button>
              ) : (
                <Link href="/login" onClick={() => setOpen(false)}>
                  <Button className="w-full">
                    <LogIn className="h-4 w-4 mr-2" />
                    Sign in
                  </Button>
                </Link>
              )}
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
