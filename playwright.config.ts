import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E configuration.
 *
 * Requirements:
 *   - PostgreSQL running (docker compose up db)
 *   - Database seeded (npx prisma db push && npx tsx prisma/seed.ts)
 *   - Or: run `npm run test:e2e:setup` which does all of the above
 *
 * The webServer block starts `next dev` locally or `next start` in CI.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,          // Sequential — tests share DB state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,                     // Single worker — avoid DB race conditions
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,                // 60s per test

  expect: {
    timeout: 15_000,              // 15s default for expect assertions
  },

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Cloudflare Access Service Token headers (for staging behind CF Access)
    ...(process.env.CF_ACCESS_CLIENT_ID ? {
      extraHTTPHeaders: {
        'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
        'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET || '',
      },
    } : {}),
  },

  projects: [
    // Setup project: authenticate and save storage state
    {
      name: 'setup',
      testMatch: /global-setup\.ts/,
      timeout: 120_000,              // Extra time for dev server JIT compilation
    },
    // Main tests using authenticated state
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  // Skip local dev server when testing against a remote staging URL
  ...(!process.env.BASE_URL ? {
    webServer: {
      command: 'npx next dev --port 3000',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      timeout: process.env.CI ? 120_000 : 30_000,
    },
  } : {}),
});
