/**
 * GET /.well-known/molt-carrier.json
 *
 * Public endpoint serving the carrier certificate (root → carrier).
 * Any MoltUA can fetch this to verify that this carrier is authorized
 * by the root authority, without needing it bundled in a MoltSIM.
 *
 * Also includes the carrier's public key for verifying registration
 * certificates and delivery signatures.
 */

import { NextResponse } from 'next/server';
import {
  getCarrierPublicKey,
  getCarrierCertificateJSON,
  CARRIER_DOMAIN,
} from '@/lib/carrier-identity';

export async function GET() {
  return NextResponse.json(
    {
      version: '1',
      carrier_domain: CARRIER_DOMAIN,
      carrier_public_key: getCarrierPublicKey(),
      key_algorithm: 'Ed25519',
      key_encoding: 'base64url SPKI DER',
      certificate: getCarrierCertificateJSON(),
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/json',
      },
    },
  );
}
