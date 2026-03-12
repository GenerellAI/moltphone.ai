/**
 * Email verification endpoint.
 *
 * GET /api/auth/verify-email?token=<token>
 *
 * Verifies the token, marks the user's email as verified, grants signup credits,
 * and redirects to the login page with a success message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { grantSignupCredits } from '@/lib/services/credits';
import { sendWelcomeEmail } from '@/lib/email';

const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');

  if (!token) {
    return NextResponse.redirect(`${BASE_URL}/login?error=missing-token`);
  }

  try {
    // Find the token
    const record = await prisma.emailVerificationToken.findUnique({
      where: { token },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            emailVerifiedAt: true,
            personalAgentId: true,
          },
        },
      },
    });

    if (!record) {
      return NextResponse.redirect(`${BASE_URL}/login?error=invalid-token`);
    }

    // Already used
    if (record.usedAt) {
      return NextResponse.redirect(`${BASE_URL}/login?verified=already`);
    }

    // Expired
    if (record.expiresAt < new Date()) {
      return NextResponse.redirect(`${BASE_URL}/login?error=token-expired`);
    }

    // Already verified (via a different token)
    if (record.user.emailVerifiedAt) {
      // Mark this token as used anyway
      await prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      return NextResponse.redirect(`${BASE_URL}/login?verified=already`);
    }

    // Verify the user + mark token used + grant credits in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: record.user.id },
        data: { emailVerifiedAt: new Date() },
      });

      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    });

    // Grant signup credits now that email is verified
    await grantSignupCredits(record.user.id);

    // Send welcome email (best-effort)
    try {
      let moltNumber: string | undefined;
      if (record.user.personalAgentId) {
        const pa = await prisma.agent.findUnique({
          where: { id: record.user.personalAgentId },
          select: { moltNumber: true },
        });
        moltNumber = pa?.moltNumber;
      }
      await sendWelcomeEmail(
        record.user.email,
        moltNumber ?? 'your MoltNumber',
        record.user.name,
      );
    } catch {
      // Non-critical
    }

    return NextResponse.redirect(`${BASE_URL}/login?verified=true`);
  } catch (e) {
    console.error('[GET /api/auth/verify-email] Error:', e);
    return NextResponse.redirect(`${BASE_URL}/login?error=verification-failed`);
  }
}
