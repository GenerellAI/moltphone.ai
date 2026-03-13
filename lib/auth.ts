import { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
// NOTE: We don't use next-auth's built-in GitHubProvider or TwitterProvider
// because they rely on openid-client which calls Node.js https.request —
// unsupported on Cloudflare Workers. Instead we define custom OAuth providers
// using fetch (see buildProviders).
import { prisma } from './prisma';
import { rateLimit } from './rate-limit';
import { generateKeyPair } from './ed25519';
import { generateMoltNumber } from './molt-number';
import { issueRegistrationCertificate } from './carrier-identity';
import { grantSignupCredits } from './services/credits';
import { verifyTurnstile } from './turnstile';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const IS_PROD = process.env.NODE_ENV === 'production';
const DEFAULT_NATION = process.env.DEFAULT_NATION_CODE || 'MPHO';

/** Generate an anonymous display name like "User-a3f8b2" */
function generateAnonName(): string {
  return `User-${crypto.randomBytes(3).toString('hex')}`;
}

// ── Build providers list at request time ──
// On Cloudflare Workers, process.env secrets are only available inside
// request handlers, not at module initialization. Build lazily.
function buildProviders(): NextAuthOptions['providers'] {
  const p: NextAuthOptions['providers'] = [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        turnstileToken: { label: 'Turnstile', type: 'text' },
      },
      async authorize(credentials, req) {
        if (!credentials?.email || !credentials?.password) return null;

        // Verify Cloudflare Turnstile (skipped when TURNSTILE_SECRET_KEY is not set)
        const turnstile = await verifyTurnstile(credentials.turnstileToken);
        if (!turnstile.success) return null;

        // Rate-limit login attempts: 10 per minute per IP
        const forwarded = req?.headers?.['x-forwarded-for'];
        const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0] : forwarded?.[0]) || 'unknown';
        const rl = await rateLimit(`login:${ip}`, {
          maxRequests: 10,
          windowMs: 60_000,
        });
        if (!rl.ok) return null;

        const user = await prisma.user.findUnique({
          where: { email: credentials.email },
        });
        if (!user || !user.passwordHash) return null;
        const valid = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!valid) return null;

        // Look up personal agent MoltNumber
        let personalMoltNumber: string | null = null;
        if (user.personalAgentId) {
          const pa = await prisma.agent.findUnique({
            where: { id: user.personalAgentId },
            select: { moltNumber: true },
          });
          personalMoltNumber = pa?.moltNumber ?? null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? '',
          role: user.role,
          personalAgentId: user.personalAgentId,
          personalMoltNumber,
        };
      },
    }),
  ];

  // Add Google OAuth if configured
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    p.push(
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      }),
    );
  }

  // Add GitHub OAuth if configured.
  // Custom fetch-based provider — the built-in GitHubProvider uses openid-client
  // which calls Node.js https.request, unsupported on Cloudflare Workers.
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    const githubClientId = process.env.GITHUB_CLIENT_ID;
    const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;
    p.push({
      id: 'github',
      name: 'GitHub',
      type: 'oauth',
      checks: ['state'],
      authorization: {
        url: 'https://github.com/login/oauth/authorize',
        params: { scope: 'read:user user:email' },
      },
      token: {
        url: 'https://github.com/login/oauth/access_token',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request({ provider, params }: any) {
          const res = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              client_id: githubClientId,
              client_secret: githubClientSecret,
              code: params.code as string,
              redirect_uri: provider.callbackUrl,
            }),
          });
          if (!res.ok) {
            const err = await res.text();
            console.error('[auth] GitHub token exchange failed:', res.status, err);
            throw new Error(`GitHub token exchange failed: ${res.status}`);
          }
          const tokens = await res.json();
          if (tokens.error) {
            console.error('[auth] GitHub token error:', tokens.error, tokens.error_description);
            throw new Error(`GitHub token error: ${tokens.error_description || tokens.error}`);
          }
          return { tokens };
        },
      },
      userinfo: {
        url: 'https://api.github.com/user',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request({ tokens }: any) {
          // Fetch user profile
          const userRes = await fetch('https://api.github.com/user', {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              Accept: 'application/vnd.github+json',
              'User-Agent': 'moltphone.ai',
            },
          });
          if (!userRes.ok) {
            console.error('[auth] GitHub userinfo failed:', userRes.status);
            throw new Error(`GitHub userinfo failed: ${userRes.status}`);
          }
          const user = await userRes.json();

          // Fetch email if not public
          if (!user.email) {
            const emailRes = await fetch('https://api.github.com/user/emails', {
              headers: {
                Authorization: `Bearer ${tokens.access_token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'moltphone.ai',
              },
            });
            if (emailRes.ok) {
              const emails = await emailRes.json();
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const primary = emails.find((e: any) => e.primary) || emails[0];
              if (primary) user.email = primary.email;
            }
          }

          return user;
        },
      },
      clientId: githubClientId,
      clientSecret: githubClientSecret,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      profile(profile: any) {
        return {
          id: String(profile.id),
          name: profile.name || profile.login,
          email: profile.email,
          image: profile.avatar_url,
        };
      },
    });
  }

  // Add Twitter/X OAuth 2.0 if configured.
  // Custom fetch-based provider — the built-in TwitterProvider uses openid-client
  // which calls Node.js https.request, unsupported on Cloudflare Workers.
  if (process.env.TWITTER_CLIENT_ID && process.env.TWITTER_CLIENT_SECRET) {
    const twitterClientId = process.env.TWITTER_CLIENT_ID;
    const twitterClientSecret = process.env.TWITTER_CLIENT_SECRET;
    p.push({
      id: 'twitter',
      name: 'Twitter',
      type: 'oauth',
      checks: ['pkce', 'state'],
      authorization: {
        url: 'https://twitter.com/i/oauth2/authorize',
        params: { scope: 'users.read tweet.read offline.access' },
      },
      token: {
        url: 'https://api.twitter.com/2/oauth2/token',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request({ provider, params, checks }: any) {
          const res = await fetch('https://api.twitter.com/2/oauth2/token', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${Buffer.from(`${twitterClientId}:${twitterClientSecret}`).toString('base64')}`,
            },
            body: new URLSearchParams({
              code: params.code as string,
              grant_type: 'authorization_code',
              redirect_uri: provider.callbackUrl,
              code_verifier: checks.code_verifier as string,
            }),
          });
          if (!res.ok) {
            const err = await res.text();
            console.error('[auth] Twitter token exchange failed:', res.status, err);
            throw new Error(`Twitter token exchange failed: ${res.status}`);
          }
          const tokens = await res.json();
          return { tokens };
        },
      },
      userinfo: {
        url: 'https://api.twitter.com/2/users/me',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async request({ tokens }: any) {
          const res = await fetch(
            'https://api.twitter.com/2/users/me?user.fields=profile_image_url,description,username',
            { headers: { Authorization: `Bearer ${tokens.access_token}` } },
          );
          if (!res.ok) {
            console.error('[auth] Twitter userinfo failed:', res.status);
            throw new Error(`Twitter userinfo failed: ${res.status}`);
          }
          return await res.json();
        },
      },
      clientId: twitterClientId,
      clientSecret: twitterClientSecret,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      profile(profile: any) {
        return {
          id: profile.data.id,
          name: profile.data.name,
          email: null,
          image: profile.data.profile_image_url?.replace('_normal.', '_400x400.') ?? null,
        };
      },
    });
  }

  return p;
}

/**
 * Provision a personal agent + MoltNumber for a new user.
 * Used by the OAuth signIn callback for first-time social logins.
 */
async function provisionPersonalAgent(userId: string, displayName: string) {
  const keyPair = generateKeyPair();
  const moltNumber = generateMoltNumber(DEFAULT_NATION, keyPair.publicKey);

  const agent = await prisma.agent.create({
    data: {
      moltNumber,
      nationCode: DEFAULT_NATION,
      ownerId: userId,
      displayName,
      description: 'Personal MoltNumber',
      publicKey: keyPair.publicKey,
      skills: ['call', 'text'],
      inboundPolicy: 'public',
    },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { personalAgentId: agent.id },
  });

  // Issue registration certificate (fire-and-forget)
  try {
    issueRegistrationCertificate({
      moltNumber,
      agentPublicKey: keyPair.publicKey,
      nationCode: DEFAULT_NATION,
    });
  } catch { /* non-critical */ }

  return agent;
}

// Use a getter so providers are built at request time, not module init.
// This ensures CF Workers secrets in process.env are available.
const _authOptionsBase: Omit<NextAuthOptions, 'providers'> = {
  callbacks: {
    async signIn({ user, account }) {
      // For OAuth logins: auto-create or link user account
      if (account?.provider && account.provider !== 'credentials') {
        try {
        // Some OAuth providers (e.g. Twitter OAuth 2.0) don't return email.
        // Fall back to a synthetic address: {provider}_{providerAccountId}@oauth.moltphone.ai
        const email = user.email
          || (account.providerAccountId
            ? `${account.provider}_${account.providerAccountId}@oauth.moltphone.ai`
            : null);
        if (!email) return false;

        // Use an anonymous display name — don't expose social usernames.
        // Users can change it later in settings.
        const displayName = generateAnonName();

        let dbUser = await prisma.user.findUnique({
          where: { email },
          select: { id: true, personalAgentId: true, emailVerifiedAt: true },
        });

        if (!dbUser) {
          // First-time OAuth user — create account (no password)
          dbUser = await prisma.user.create({
            data: {
              email,
              name: displayName,
              // No passwordHash — OAuth-only account
              emailVerifiedAt: new Date(), // OAuth emails are pre-verified
            },
            select: { id: true, personalAgentId: true, emailVerifiedAt: true },
          });

          // Provision personal agent + MoltNumber (non-blocking — don't fail login if nation missing)
          try {
            await provisionPersonalAgent(dbUser.id, displayName);
          } catch (err) {
            console.error('[auth] provisionPersonalAgent failed:', err);
          }

          // Grant signup credits
          try {
            await grantSignupCredits(dbUser.id);
          } catch (err) {
            console.error('[auth] grantSignupCredits failed:', err);
          }
        } else {
          // Existing user logging in via OAuth — mark email verified if not already
          if (!dbUser.emailVerifiedAt) {
            await prisma.user.update({
              where: { id: dbUser.id },
              data: { emailVerifiedAt: new Date() },
            });
          }
          // Provision personal agent if missing (edge case)
          if (!dbUser.personalAgentId) {
            await provisionPersonalAgent(dbUser.id, displayName);
          }
        }

        // Overwrite the user object so the JWT callback gets the DB id
        user.id = dbUser.id;
        } catch (err) {
          console.error('[auth] OAuth signIn callback failed:', err);
          return false;
        }
      }
      return true;
    },
    async session({ session, token }) {
      if (token.sub) {
        session.user = {
          ...session.user,
          id: token.sub,
          role: token.role as string | undefined,
          personalAgentId: token.personalAgentId as string | undefined,
          personalMoltNumber: token.personalMoltNumber as string | undefined,
        } as typeof session.user & { id: string };
      }
      return session;
    },
    async jwt({ token, user, trigger }) {
      if (user) {
        const u = user as unknown as Record<string, unknown>;
        token.sub = user.id;
        token.role = u.role;
        token.personalAgentId = u.personalAgentId;
        token.personalMoltNumber = u.personalMoltNumber;
      }

      // For OAuth users, the user object from signIn doesn't have our custom fields.
      // Fetch them from DB on first sign-in or when session is updated.
      if ((trigger === 'signIn' || !token.personalAgentId) && token.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { role: true, personalAgentId: true },
        });
        if (dbUser) {
          token.role = dbUser.role;
          token.personalAgentId = dbUser.personalAgentId;
          if (dbUser.personalAgentId) {
            const pa = await prisma.agent.findUnique({
              where: { id: dbUser.personalAgentId },
              select: { moltNumber: true },
            });
            token.personalMoltNumber = pa?.moltNumber ?? null;
          }
        }
      }

      return token;
    },
  },
  pages: {
    signIn: '/login',
  },
  // In production: Secure cookies (HTTPS-only), strict SameSite, HttpOnly
  // Prevents session hijacking on public WiFi / MitM
  ...(IS_PROD ? {
    cookies: {
      sessionToken: {
        name: '__Secure-next-auth.session-token',
        options: {
          httpOnly: true,
          sameSite: 'lax' as const,
          path: '/',
          secure: true,
        },
      },
    },
  } : {}),
  secret: process.env.NEXTAUTH_SECRET || (IS_PROD
    ? (() => { throw new Error('NEXTAUTH_SECRET must be set in production'); })()
    : 'dev-secret-change-me'),
};

// Re-export with lazy providers so CF Workers secrets are available at request time.
// The getter ensures buildProviders() runs inside a request handler, not at module init.
const _authBase = _authOptionsBase;
export const authOptions: NextAuthOptions = Object.defineProperty(
  { ..._authBase },
  'providers',
  { get: buildProviders, enumerable: true },
) as NextAuthOptions;

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email?: string | null;
      name?: string | null;
      role?: string | null;
      personalAgentId?: string | null;
      personalMoltNumber?: string | null;
    };
  }
}
