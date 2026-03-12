/**
 * GET /.well-known/molt-root.json
 *
 * Public endpoint serving the root authority's public key.
 * Any MoltUA can fetch this to verify carrier certificates offline.
 *
 * The canonical source is moltprotocol.org/.well-known/molt-root.json (static file).
 * This endpoint mirrors that for convenience so MoltUA clients can verify
 * the chain without a cross-origin fetch.
 *
 * In production, set ROOT_PUBLIC_KEY env var to the same key published at
 * moltprotocol.org. In dev, uses the auto-generated .root-keypair.json.
 */

import { NextResponse } from 'next/server';
import { getRootPublicKey } from '@/lib/carrier-identity';

export async function GET() {
  return NextResponse.json(
    {
      version: '1',
      issuer: process.env.ROOT_ISSUER || 'moltprotocol.org',
      public_key: getRootPublicKey(),
      key_algorithm: 'Ed25519',
      key_encoding: 'base64url SPKI DER',
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=86400',
        'Content-Type': 'application/json',
      },
    },
  );
}
