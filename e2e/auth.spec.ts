/**
 * E2E tests for login and register flows.
 *
 * Tests unauthenticated pages — uses its own context (no saved auth state).
 */

import { test, expect } from '@playwright/test';

// These tests run WITHOUT pre-saved auth state
test.use({ storageState: { cookies: [], origins: [] } });

// When running against a remote staging URL (CF Workers), networkidle never
// fires because Cloudflare analytics/beacon scripts keep the network active.
// Locally (Next.js dev server), networkidle is needed for React hydration.
const isRemote = !!process.env.BASE_URL;

/** Wait for form to be interactive (hydrated) after navigation. */
async function waitForHydration(page: import('@playwright/test').Page) {
  if (isRemote) {
    // On CF Workers with always-pass Turnstile, wait for the submit button
    // to be enabled — this proves React has hydrated AND Turnstile completed.
    await expect(page.getByRole('main').getByRole('button').first()).toBeEnabled({ timeout: 30_000 });
  } else {
    // Locally, networkidle reliably indicates React has hydrated
    await page.waitForLoadState('networkidle');
  }
}

test.describe('Login page', () => {
  test('renders the login form', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByText('Sign in to MoltPhone')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('main').getByRole('button', { name: /login/i })).toBeVisible();
  });

  test('shows link to register page', async ({ page }) => {
    await page.goto('/login');

    const registerLink = page.getByRole('link', { name: 'Register' });
    await expect(registerLink).toBeVisible();
    await expect(registerLink).toHaveAttribute('href', '/register');
  });

  test('shows social login options', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('button', { name: /GitHub/i })).toBeVisible();
  });

  test('rejects invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);

    await page.getByLabel('Email').fill('bad@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('main').getByRole('button', { name: /login/i }).click();

    await expect(page.getByText('Invalid email or password')).toBeVisible({ timeout: 15_000 });
  });

  test('logs in with demo credentials and redirects home', async ({ page }) => {
    await page.goto('/login');
    await waitForHydration(page);

    await page.getByLabel('Email').fill('demo@moltphone.ai');
    await page.getByLabel('Password').fill('demo1234');
    await page.getByRole('main').getByRole('button', { name: /login/i }).click();

    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/, { timeout: 30_000 });
    // Should not show the login page content anymore
    await expect(page.getByText('Sign in to MoltPhone')).not.toBeVisible();
  });
});

test.describe('Register page', () => {
  test('renders the registration form', async ({ page }) => {
    await page.goto('/register');

    await expect(page.getByText('Join MoltPhone')).toBeVisible();
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: /register/i })).toBeVisible();
  });

  test('shows link to login page', async ({ page }) => {
    await page.goto('/register');

    // Scope to main to avoid matching navbar "Sign in" link
    const loginLink = page.getByRole('main').getByRole('link', { name: 'Sign in' });
    await expect(loginLink).toBeVisible();
    await expect(loginLink).toHaveAttribute('href', '/login');
  });

  test('rejects duplicate email registration', async ({ page }) => {
    await page.goto('/register');
    await waitForHydration(page);

    await page.getByLabel('Name').fill('Test User');
    await page.getByLabel('Email').fill('demo@moltphone.ai');
    await page.getByLabel('Password').fill('password123');
    await page.getByRole('button', { name: /register/i }).click();

    // Should show "Email already registered" error (API may be slow under dev load)
    await expect(page.getByText('Email already registered')).toBeVisible({ timeout: 15_000 });
  });
});
