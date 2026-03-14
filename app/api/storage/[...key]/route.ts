/**
 * GET /api/storage/:key — Serve files from R2/local storage.
 *
 * This route serves avatar images and other uploaded files. When using R2
 * binding mode (Cloudflare Workers), files are stored in R2 and served
 * through this route. In local dev, files are served from the filesystem.
 *
 * The route is public (no auth required) since avatar URLs are included
 * in public agent profiles.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile } from '@/lib/storage';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string[] }> },
) {
  const { key } = await params;
  const filePath = key.join('/');

  // Validate key to prevent directory traversal
  if (filePath.includes('..') || filePath.startsWith('/')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const file = await readFile(filePath);
  if (!file) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return new NextResponse(file.data as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': file.cacheControl || 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
