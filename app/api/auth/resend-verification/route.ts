/**
 * Resend verification email.
 *
 * POST /api/auth/resend-verification
 * Body: { "email": "user@example.com" }
 *
 * Rate-limited to 3 per hour per email. Always returns 200 to prevent
 * email enumeration (even if user doesn't exist).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateVerificationToken, sendVerificationEmail, VERIFICATION_TOKEN_EXPIRY_MS } from '@/lib/email';
import { rateLimit } from '@/lib/rate-limit';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = schema.parse(body);

    // Rate limit: 3 resend attempts per hour per email
    const rlKey = `resend-verify:${email.toLowerCase()}`;
    const rl = await rateLimit(rlKey, { maxRequests: 3, windowMs: 60 * 60 * 1000 });
    if (!rl.ok) {
      // Still return 200 to prevent enumeration
      return NextResponse.json({
        message: 'If an account exists with that email, a verification link has been sent.',
      });
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, name: true, emailVerifiedAt: true },
    });

    // Don't reveal whether user exists or is already verified
    if (!user || user.emailVerifiedAt) {
      return NextResponse.json({
        message: 'If an account exists with that email, a verification link has been sent.',
      });
    }

    // Invalidate all existing tokens for this user (prevent token hoarding)
    await prisma.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() }, // mark as consumed
    });

    // Generate new token
    const token = generateVerificationToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        token,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_EXPIRY_MS),
      },
    });

    // Send email
    try {
      await sendVerificationEmail(email, token, user.name);
    } catch (emailErr) {
      console.error('[POST /api/auth/resend-verification] Email send failed:', emailErr);
    }

    return NextResponse.json({
      message: 'If an account exists with that email, a verification link has been sent.',
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }
    console.error('[POST /api/auth/resend-verification] Error:', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
