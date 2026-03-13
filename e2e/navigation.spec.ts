/**
 * E2E tests for homepage and sidebar navigation.
 *
 * Uses authenticated state (demo user).
 */

import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('renders hero section', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('AI Agents are ready for their first phone')).toBeVisible();
    // Use heading role to target specific MoltNumber heading (many instances on page)
    await expect(page.getByRole('heading', { name: 'MoltNumber' })).toBeVisible();
  });

  test('shows MoltPhone logo in navbar', async ({ page }) => {
    await page.goto('/');

    // Scope to the navbar link to avoid matching footer/svg/other instances
    await expect(page.getByRole('link', { name: /jellyfish MoltPhone/ })).toBeVisible();
  });

  test('shows network stats', async ({ page }) => {
    await page.goto('/');

    // Stats section should show counts for agents, nations, tasks
    // These are from the seeded database
    await expect(page.getByText(/agents/i).first()).toBeVisible();
    await expect(page.getByText(/nations/i).first()).toBeVisible();
  });

  test('has CTA buttons', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('link', { name: /give your agent a moltnumber/i })).toBeVisible();
    // Agent Self-Signup button in main CTA area
    await expect(page.getByRole('main').getByRole('link', { name: /agent self-signup/i })).toBeVisible();
  });
});

test.describe('Sidebar navigation', () => {
  test('shows sidebar when logged in', async ({ page }) => {
    await page.goto('/');

    // Sidebar should have menu label or nav links
    await expect(page.getByText('Menu')).toBeVisible({ timeout: 5000 });
  });

  test('navigates to Agents & Nations', async ({ page }) => {
    await page.goto('/');

    // Scope to sidebar (complementary role = <aside>)
    await page.getByRole('complementary').getByRole('link', { name: 'Agents & Nations' }).click();
    await expect(page).toHaveURL(/\/agents/, { timeout: 20_000 });
  });

  test('navigates to Discover Agents (Nations)', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('complementary').getByRole('link', { name: 'Discover Agents' }).click();
    await expect(page).toHaveURL(/\/discover-agents/, { timeout: 20_000 });
  });

  test('navigates to Contacts', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('complementary').getByRole('link', { name: 'Contacts' }).click();
    await expect(page).toHaveURL(/\/contacts/, { timeout: 20_000 });
  });

  test('navigates to Calls', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('complementary').getByRole('link', { name: 'Calls' }).click();
    await expect(page).toHaveURL(/\/calls/, { timeout: 20_000 });
  });

  test('navigates to Blocked', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('complementary').getByRole('link', { name: 'Blocked' }).click();
    await expect(page).toHaveURL(/\/blocked/, { timeout: 20_000 });
  });

  test('can close and reopen sidebar', async ({ page }) => {
    await page.goto('/');

    // Close sidebar — the aside slides out via CSS translate
    await page.getByLabel('Close sidebar').click();
    // After close, the "Open sidebar" button should appear
    await expect(page.getByLabel('Open sidebar')).toBeVisible({ timeout: 10_000 });

    // Reopen sidebar
    await page.getByLabel('Open sidebar').click();
    await expect(page.getByText('Menu')).toBeVisible();
  });

  test('shows personal MoltNumber', async ({ page }) => {
    await page.goto('/');

    // The sidebar shows the user's personal agent MoltNumber (seeded)
    // Scope to the sidebar (complementary) to avoid matching main content
    await expect(page.getByRole('complementary').locator('text=/MPHO-/')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Nations page', () => {
  test('lists seeded nations', async ({ page }) => {
    await page.goto('/nations');

    // Seeded nations: MPHO (carrier), MOLT (open), CLAW (may not show)
    // Use specific nation code text which is unique
    await expect(page.getByText('MPHO').first()).toBeVisible();
  });
});
