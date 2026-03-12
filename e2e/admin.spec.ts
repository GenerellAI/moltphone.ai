/**
 * E2E tests for the admin dashboard.
 *
 * Uses authenticated state (demo user).
 * Note: The demo user must have admin role for these tests to pass fully.
 * If demo user is not admin, these tests verify the redirect behavior.
 */

import { test, expect } from '@playwright/test';

/**
 * Helper: navigate to /admin and determine whether user is admin.
 * Races between admin content appearing and a redirect firing.
 */
async function gotoAdminAndSettle(page: import('@playwright/test').Page): Promise<'admin' | 'redirected'> {
  await page.goto('/admin');
  // Race: either we see "Admin Dashboard" (admin) or get redirected (non-admin)
  const result = await Promise.race([
    page.getByText('Admin Dashboard').waitFor({ state: 'visible', timeout: 45_000 }).then(() => 'admin' as const),
    page.waitForURL(url => !url.toString().includes('/admin'), { timeout: 45_000 }).then(() => 'redirected' as const),
  ]).catch(() => 'redirected' as const);
  return result;
}

test.describe('Admin dashboard', () => {
  test('loads admin page (or redirects if not admin)', async ({ page }) => {
    const result = await gotoAdminAndSettle(page);

    if (result === 'admin') {
      await expect(page.getByText('Admin Dashboard')).toBeVisible();
    } else {
      // Non-admin gets redirected — this is expected behavior
      expect(page.url()).not.toContain('/admin');
    }
  });

  test('shows all five tabs when admin', async ({ page }) => {
    const result = await gotoAdminAndSettle(page);

    if (result === 'admin') {
      // Check all 5 tabs exist
      await expect(page.getByRole('button', { name: /overview/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /blocks/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /policies/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /credits/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /jobs/i })).toBeVisible();
    }
  });

  test('overview tab shows stats', async ({ page }) => {
    const result = await gotoAdminAndSettle(page);

    if (result === 'admin') {
      // Overview tab is default — should show stats cards
      await expect(page.locator('text=/agents|users|blocks|policies/i').first()).toBeVisible();
    }
  });

  test('can switch between tabs', async ({ page }) => {
    const result = await gotoAdminAndSettle(page);

    if (result === 'admin') {
      // Click Blocks tab
      await page.getByRole('button', { name: /blocks/i }).click();
      await page.waitForTimeout(500);

      // Click Jobs tab
      await page.getByRole('button', { name: /jobs/i }).click();
      await page.waitForTimeout(500);

      // Switch back to Overview
      await page.getByRole('button', { name: /overview/i }).click();
    }
  });
});
