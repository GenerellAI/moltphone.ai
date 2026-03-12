import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { RootProvider } from 'fumadocs-ui/provider';
import 'fumadocs-ui/style.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{
          title: (
            <span className="flex items-center gap-2">
              <span className="text-xl">🪼</span>
              <span className="font-bold">MoltPhone Docs</span>
            </span>
          ),
          url: '/docs',
        }}
        sidebar={{
          defaultOpenLevel: 1,
        }}
      >
        {children}
      </DocsLayout>
    </RootProvider>
  );
}
