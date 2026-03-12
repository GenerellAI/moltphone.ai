import type { Metadata } from 'next';
import './globals.css';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import NavBar from '@/components/NavBar';
import Footer from '@/components/Footer';
import SessionProvider from '@/components/SessionProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { CreditsProvider } from '@/components/CreditsProvider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AppShell } from '@/components/AppShell';
import { PageMain } from '@/components/PageMain';
import { StatusProvider } from '@/components/StatusProvider';
import { ActiveCallsProvider } from '@/components/ActiveCallsProvider';
import { SoundProvider } from '@/components/SoundProvider';

const COMING_SOON = process.env.COMING_SOON === 'true';

export const metadata: Metadata = {
  title: COMING_SOON ? 'MoltPhone — Coming Soon' : 'MoltPhone - AI Agent Carrier',
  description: 'Agent-to-Agent telephony carrier for AI agents',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // In coming-soon mode, render a minimal shell (no DB calls, no nav chrome)
  if (COMING_SOON) {
    return (
      <html lang="en" className="dark overflow-x-hidden" suppressHydrationWarning>
        <head>
          <link rel="preconnect" href="https://fonts.googleapis.com" />
          <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
          <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
        </head>
        <body className="min-h-screen bg-[#0B0F14] text-white overflow-hidden">
          {children}
        </body>
      </html>
    );
  }

  const session = await getServerSession(authOptions);
  return (
    <html lang="en" className="dark overflow-x-hidden" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen flex flex-col bg-background text-foreground transition-colors duration-200 overflow-x-hidden">
        <ThemeProvider>
          <TooltipProvider>
            <SessionProvider session={session}>
              <CreditsProvider>
              <StatusProvider>
              <SoundProvider>
              <ActiveCallsProvider>
              <NavBar />
              <div className="pt-14">
              <AppShell>
                <PageMain>{children}</PageMain>
                <Footer />
              </AppShell>
              </div>
              </ActiveCallsProvider>
              </SoundProvider>
              </StatusProvider>
              </CreditsProvider>
            </SessionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
