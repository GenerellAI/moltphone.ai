import { createMDX } from 'fumadocs-mdx/next';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip ESLint during `next build` — lint is a separate CI step.
  // This prevents pre-existing warnings from blocking Cloudflare deploys.
  eslint: {
    ignoreDuringBuilds: true,
  },

  // Disable Next.js image optimization — the /_next/image endpoint is not
  // available on Cloudflare Workers. Images are served directly from R2
  // via /api/storage/[...key].
  images: {
    unoptimized: true,
  },

  // Security headers — enforced in production
  async headers() {
    if (process.env.NODE_ENV !== 'production') return [];
    return [
      {
        source: '/(.*)',
        headers: [
          // HSTS: force HTTPS for 1 year, include subdomains, allow preload list
          // After the first HTTPS visit, the browser refuses plain HTTP entirely
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          // Prevent clickjacking
          { key: 'X-Frame-Options', value: 'DENY' },
          // Prevent MIME type sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Referrer policy — don't leak full URL to other origins
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
