/**
 * Email service for MoltPhone.
 *
 * Uses Resend HTTP API (https://resend.com) — works on Cloudflare Workers
 * (no TCP sockets needed, unlike nodemailer).
 *
 * In development, falls back to console logging (no actual email sent)
 * unless RESEND_API_KEY is configured.
 *
 * Environment variables:
 *   RESEND_API_KEY  - Resend API key (re_...)
 *   EMAIL_FROM      - From address (default: MoltPhone <noreply@moltphone.ai>)
 *   NEXTAUTH_URL    - Base URL for links in emails
 */

import crypto from 'crypto';

const IS_DEV = process.env.NODE_ENV !== 'production';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'MoltPhone <noreply@mail.moltphone.ai>';
const BASE_URL = process.env.NEXTAUTH_URL || 'http://localhost:3000';

/** Token expiry: 24 hours */
export const VERIFICATION_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Generate a cryptographically secure verification token.
 * URL-safe base64, 32 bytes = 43 characters.
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Send an email via Resend HTTP API.
 * Returns null in dev if RESEND_API_KEY is not configured (console fallback).
 */
async function sendEmail(params: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<void> {
  if (!RESEND_API_KEY) {
    if (IS_DEV) {
      // Dev fallback: log to console
      console.log('\n📧 ══════════════════════════════════════════');
      console.log(`  To: ${params.to}`);
      console.log(`  Subject: ${params.subject}`);
      console.log('══════════════════════════════════════════════\n');
      return;
    }
    throw new Error('RESEND_API_KEY must be configured in production');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[email] Resend API error ${res.status}: ${body}`);
    throw new Error(`Email send failed: ${res.status}`);
  }
}

/**
 * Send a verification email to a new user.
 */
export async function sendVerificationEmail(
  to: string,
  token: string,
  name?: string | null,
): Promise<void> {
  const verifyUrl = `${BASE_URL}/api/auth/verify-email?token=${token}`;
  const greeting = name ? `Hi ${name}` : 'Hi there';

  const subject = 'Verify your MoltPhone email';
  const text = `${greeting},\n\nVerify your email to activate your MoltNumber:\n\n${verifyUrl}\n\nThis link expires in 24 hours.\n\n— MoltPhone`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #2d7efe; margin-bottom: 24px;">🪼 MoltPhone</h2>
      <p>${greeting},</p>
      <p>Verify your email to activate your MoltNumber:</p>
      <p style="margin: 24px 0;">
        <a href="${verifyUrl}" style="background: #2d7efe; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Verify Email
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">This link expires in 24 hours.</p>
      <p style="color: #666; font-size: 14px;">If you didn't create a MoltPhone account, you can safely ignore this email.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;"><a href="https://moltphone.ai" style="color: #999; text-decoration: none;">MoltPhone</a> – A carrier on <a href="https://moltprotocol.org" style="color: #999; text-decoration: none;">MoltProtocol</a></p>
    </div>
  `;

  const transporter = !RESEND_API_KEY;

  if (transporter && IS_DEV) {
    // Dev fallback: log to console
    console.log('\n📧 ══════════════════════════════════════════');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Verify URL: ${verifyUrl}`);
    console.log('══════════════════════════════════════════════\n');
    return;
  }

  await sendEmail({ to, subject, text, html });
}

/**
 * Send a "welcome, you're verified" confirmation email.
 */
export async function sendWelcomeEmail(
  to: string,
  moltNumber: string,
  name?: string | null,
): Promise<void> {
  const greeting = name ? `Hi ${name}` : 'Hi there';
  const dashboardUrl = `${BASE_URL}/agents`;

  const subject = 'Welcome to MoltPhone! 🪼';
  const text = `${greeting},\n\nYour email is verified and your free MoltNumber ${moltNumber} is active.\n\nCalling and texting agents is completely free. You also received 10,000 bonus credits for premium features like registering additional agents.\n\nVisit your dashboard: ${dashboardUrl}\n\n— MoltPhone`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #2d7efe; margin-bottom: 24px;">🪼 MoltPhone</h2>
      <p>${greeting},</p>
      <p>Your email is verified and your free MoltNumber <strong>${moltNumber}</strong> is active.</p>
      <p style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; font-size: 14px;">
        <strong>MoltPhone is free to use.</strong> Calling and texting agents costs nothing.
        You also received <strong>10,000 bonus credits</strong> for premium features like registering additional agents and privacy relay mode.
      </p>
      <p style="margin: 24px 0;">
        <a href="${dashboardUrl}" style="background: #2d7efe; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Go to Dashboard
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;"><a href="https://moltphone.ai" style="color: #999; text-decoration: none;">MoltPhone</a> – A carrier on <a href="https://moltprotocol.org" style="color: #999; text-decoration: none;">MoltProtocol</a></p>
    </div>
  `;

  if (!RESEND_API_KEY && IS_DEV) {
    console.log('\n📧 ══════════════════════════════════════════');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Welcome! MoltNumber: ${moltNumber}`);
    console.log('══════════════════════════════════════════════\n');
    return;
  }

  await sendEmail({ to, subject, text, html });
}

/**
 * Send a claim success notification email.
 * Sent to the human owner after they claim an agent via self-signup.
 */
export async function sendClaimNotificationEmail(
  to: string,
  agentName: string,
  moltNumber: string,
  nationCode: string,
  ownerName?: string | null,
): Promise<void> {
  const greeting = ownerName ? `Hi ${ownerName}` : 'Hi there';
  const agentUrl = `${BASE_URL}/agents`;

  const subject = `Agent claimed: ${agentName} (${moltNumber})`;
  const text = `${greeting},\n\nYou've successfully claimed the agent "${agentName}" (${moltNumber}, nation: ${nationCode}).\n\nThe agent is now fully active under your account and can call out.\n\nManage your agents: ${agentUrl}\n\n— MoltPhone`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #2d7efe; margin-bottom: 24px;">🪼 MoltPhone</h2>
      <p>${greeting},</p>
      <p>You've successfully claimed the agent:</p>
      <div style="background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0 0 8px 0; font-weight: 600; color: #fff;">${agentName}</p>
        <p style="margin: 0 0 4px 0; font-family: monospace; font-size: 14px; color: #aaa;">${moltNumber}</p>
        <p style="margin: 0; font-size: 13px; color: #888;">Nation: ${nationCode}</p>
      </div>
      <p style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 12px 16px; font-size: 14px;">
        The agent is now <strong>fully active</strong> — it can call out and appears in public listings.
      </p>
      <p style="margin: 24px 0;">
        <a href="${agentUrl}" style="background: #2d7efe; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Manage Your Agents
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px;"><a href="https://moltphone.ai" style="color: #999; text-decoration: none;">MoltPhone</a> – A carrier on <a href="https://moltprotocol.org" style="color: #999; text-decoration: none;">MoltProtocol</a></p>
    </div>
  `;

  if (!RESEND_API_KEY && IS_DEV) {
    console.log('\n📧 ══════════════════════════════════════════');
    console.log(`  To: ${to}`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Claimed: ${agentName} (${moltNumber})`);
    console.log('══════════════════════════════════════════════\n');
    return;
  }

  await sendEmail({ to, subject, text, html });
}
