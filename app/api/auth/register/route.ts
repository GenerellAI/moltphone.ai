import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateKeyPair } from '@/lib/ed25519';
import { generateMoltNumber } from '@/lib/molt-number';
import { issueRegistrationCertificate, registrationCertToJSON, getCarrierCertificateJSON } from '@/lib/carrier-identity';
import { generateVerificationToken, sendVerificationEmail, VERIFICATION_TOKEN_EXPIRY_MS } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { verifyTurnstile } from '@/lib/turnstile';
import bcrypt from 'bcryptjs';
import { z } from 'zod';

/** Default nation code for personal agents. */
const DEFAULT_NATION = process.env.DEFAULT_NATION_CODE || 'MPHO';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
  turnstileToken: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    // Rate-limit registration: 5 per hour per IP
    const forwarded = req.headers.get('x-forwarded-for');
    const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`register:${ip}`, {
      maxRequests: 5,
      windowMs: 60 * 60 * 1000, // 1 hour
    });
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: rl.headers },
      );
    }

    const body = await req.json();
    const { email, password, name, turnstileToken } = schema.parse(body);

    // Verify Cloudflare Turnstile (skipped when TURNSTILE_SECRET_KEY is not set)
    const turnstile = await verifyTurnstile(turnstileToken);
    if (!turnstile.success) {
      return NextResponse.json(
        { error: turnstile.error || 'Bot verification failed' },
        { status: 403 },
      );
    }
    
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return NextResponse.json({ error: 'Email already registered' }, { status: 409 });

    // Check for duplicate display names (case-insensitive)
    if (name) {
      const nameTaken = await prisma.user.findFirst({
        where: { name: { equals: name.trim(), mode: 'insensitive' } },
        select: { id: true },
      });
      if (nameTaken) {
        return NextResponse.json({ error: 'That display name is already taken' }, { status: 409 });
      }
    }
    
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate Ed25519 keypair + MoltNumber for the personal agent
    const keyPair = generateKeyPair();
    const moltNumber = generateMoltNumber(DEFAULT_NATION, keyPair.publicKey);

    // Generate email verification token
    const verificationToken = generateVerificationToken();

    // Create user + personal agent + verification token in a transaction
    // NOTE: Signup credits are NOT granted here — they're granted on email verification.
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name, passwordHash },
        select: { id: true, email: true, name: true },
      });

      const agent = await tx.agent.create({
        data: {
          moltNumber,
          nationCode: DEFAULT_NATION,
          ownerId: user.id,
          displayName: name || email.split('@')[0],
          description: 'Personal MoltNumber',
          publicKey: keyPair.publicKey,
          skills: ['call', 'text'],
          inboundPolicy: 'public',
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { personalAgentId: agent.id },
      });

      // Create verification token (24h expiry)
      await tx.emailVerificationToken.create({
        data: {
          userId: user.id,
          token: verificationToken,
          expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS),
        },
      });

      return { user, agent };
    });

    // Send verification email (fire-and-forget in dev, awaited in production)
    try {
      await sendVerificationEmail(email, verificationToken, name);
    } catch (emailErr) {
      console.error('[POST /api/auth/register] Failed to send verification email:', emailErr);
      // Don't fail registration if email sending fails — user can resend
    }

    // Issue registration certificate
    const registrationCert = issueRegistrationCertificate({
      moltNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: DEFAULT_NATION,
    });

    return NextResponse.json({
      ...result.user,
      emailVerified: false,
      message: 'Check your email to verify your account and activate your free MoltNumber.',
      personalAgent: {
        id: result.agent.id,
        moltNumber,
        privateKey: keyPair.privateKey,
        registrationCertificate: registrationCertToJSON(registrationCert),
        carrierCertificate: getCarrierCertificateJSON(),
      },
      // In development mode, include the verification token so E2E tests can
      // auto-verify without parsing emails.
      ...(process.env.NODE_ENV === 'development' ? { verificationToken } : {}),
    }, { status: 201 });
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.issues }, { status: 400 });
    console.error('[POST /api/auth/register] Internal error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
