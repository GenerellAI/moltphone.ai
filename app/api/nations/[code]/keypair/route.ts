/**
 * POST /api/nations/:code/keypair — Generate a new Ed25519 keypair for a nation.
 *
 * The public key is stored on the Nation model. The private key is returned
 * ONCE (like MoltSIM provisioning). Re-generating rotates the key and
 * invalidates all existing delegation certificates.
 *
 * Only the nation owner can generate a keypair. Only org and carrier nations
 * use keypairs (open nations don't need delegation).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireHttps } from '@/lib/require-https';
import { isNationAdmin } from '@/lib/nation-admin';
import { generateNationKeypair } from '@/lib/services/nation-delegation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  // Private key in response — require HTTPS
  const httpsCheck = requireHttps(req);
  if (httpsCheck) return httpsCheck;

  const session = await getServerSession(authOptions);
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;
  const nationCode = code.toUpperCase();

  const nation = await prisma.nation.findUnique({
    where: { code: nationCode },
    select: { ownerId: true, adminUserIds: true, type: true, isActive: true, publicKey: true },
  });

  if (!nation) return NextResponse.json({ error: 'Nation not found' }, { status: 404 });
  if (!isNationAdmin(nation, session.user.id)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!nation.isActive) return NextResponse.json({ error: 'Nation has been deactivated' }, { status: 403 });

  if (nation.type !== 'org' && nation.type !== 'carrier') {
    return NextResponse.json(
      { error: 'Keypairs are only used for org or carrier nations. Open nations do not need delegation certificates.' },
      { status: 400 },
    );
  }

  try {
    const keyPair = await generateNationKeypair(nationCode);

    return NextResponse.json({
      nationCode,
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey,
      warning: 'Save this private key now. It will not be shown again. ' +
        (nation.publicKey
          ? 'The previous keypair has been revoked. All existing delegation certificates are now invalid.'
          : 'Use this key to sign delegation certificates for carriers.'),
      keyAlgorithm: 'Ed25519',
      keyEncoding: 'base64url (SPKI DER for public, PKCS#8 DER for private)',
    }, { status: 201 });
  } catch (err) {
    console.error('[POST /api/nations/:code/keypair]', err);
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
