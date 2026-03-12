/**
 * Global setup — authenticates as the demo user and saves session state.
 *
 * This runs once before all tests. The resulting storage state (cookies + localStorage)
 * is reused by all test files, so they start already logged in.
 *
 * Uses the NextAuth credentials API directly rather than the UI form, since
 * the dev server's JIT compilation makes UI-based login unreliable on slow CI.
 *
 * Demo credentials come from prisma/seed.ts:
 *   email: demo@moltphone.ai
 *   password: demo1234
 */

import { test as setup, expect } from '@playwright/test';
import path from 'path';

const authFile = path.join(__dirname, '.auth', 'user.json');

setup('authenticate as demo user', async ({ page }) => {
  const baseURL = page.context().pages()[0]?.url()
    ? new URL(page.context().pages()[0].url()).origin
    : 'http://localhost:3000';

  // 1. Fetch the NextAuth CSRF token
  const csrfRes = await page.request.get('/api/auth/csrf');
  const { csrfToken } = await csrfRes.json();

  // 2. Sign in via the NextAuth credentials endpoint (POST form)
  //    turnstileToken must be non-empty for staging (uses CF always-pass test key)
  const signInRes = await page.request.post('/api/auth/callback/credentials', {
    form: {
      email: 'demo@moltphone.ai',
      password: 'demo1234',
      turnstileToken: 'e2e-test-token',
      csrfToken,
      json: 'true',
    },
  });

  // The response should set a session cookie and redirect
  expect(signInRes.ok() || signInRes.status() === 302).toBeTruthy();

  // 3. Verify the session works by visiting a page
  await page.goto('/', { timeout: 60_000 });

  // Verify we're logged in — page should not show the sign-in prompt
  await expect(page.locator('body')).not.toContainText('Sign in to MoltPhone', { timeout: 15_000 });

  // Save authentication state (cookies)
  await page.context().storageState({ path: authFile });
});
