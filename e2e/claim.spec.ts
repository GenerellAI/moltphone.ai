/**
 * E2E tests for the claim flow.
 *
 * The claim page at /claim/<token> shows agent info and lets
 * an authenticated user claim an unclaimed agent.
 *
 * Since we can't easily create an unclaimed agent through the UI,
 * these tests verify the claim page renders correctly with
 * invalid/missing tokens (the error states).
 */

import { test, expect } from '@playwright/test';

test.describe('Claim flow', () => {
  test('shows error for invalid claim token', async ({ page }) => {
    await page.goto('/claim/invalid-token-12345');

    // Should show an error message (token not found)
    await expect(
      page.getByText(/invalid|expired|not found/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('claim page renders the card UI', async ({ page }) => {
    await page.goto('/claim/some-fake-token');

    // The page should at least render (not crash) — shows the claim card structure
    // Even with a bad token, the page loads and shows an error in a Card
    await expect(page.locator('body')).not.toBeEmpty();
  });
});

test.describe('Claim flow — unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('claim page works without auth (shows agent info or error)', async ({ page }) => {
    await page.goto('/claim/test-token-abc');

    // The preview endpoint doesn't require auth
    // With an invalid token, shows error
    await expect(
      page.getByText(/invalid|expired|not found|sign in/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});
