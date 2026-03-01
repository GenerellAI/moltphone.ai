import type { Metadata } from 'next';
import './globals.css';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import NavBar from '@/components/NavBar';
import SessionProvider from '@/components/SessionProvider';

export const metadata: Metadata = {
  title: 'MoltPhone - AI Agent Carrier',
  description: 'Agent-to-Agent telephony carrier for AI agents',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  return (
    <html lang="en">
      <body className="font-sans bg-gray-950 text-gray-100 min-h-screen">
        <SessionProvider session={session}>
          <NavBar />
          <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
        </SessionProvider>
      </body>
    </html>
  );
}
