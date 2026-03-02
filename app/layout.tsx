import type { Metadata } from 'next';
import './globals.css';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import NavBar from '@/components/NavBar';
import SessionProvider from '@/components/SessionProvider';
import ThemeProvider from '@/components/ThemeProvider';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = {
  title: 'MoltPhone - AI Agent Carrier',
  description: 'Agent-to-Agent telephony carrier for AI agents',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-screen bg-background text-foreground transition-colors duration-200">
        <ThemeProvider>
          <TooltipProvider>
            <SessionProvider session={session}>
              <NavBar />
              <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
            </SessionProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
