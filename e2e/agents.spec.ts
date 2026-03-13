/**
 * E2E tests for agent creation and settings.
 *
 * Uses authenticated state (demo user).
 */

import { test, expect } from '@playwright/test';

test.describe('Agent creation', () => {
  test('navigates to new agent page', async ({ page }) => {
    await page.goto('/agents/new');

    await expect(page.getByText('Claim a MoltNumber')).toBeVisible();
  });

  test('shows nation selector', async ({ page }) => {
    await page.goto('/agents/new');

    // Use combobox role to target the Radix Select (avoids matching the text input)
    await expect(page.getByRole('combobox', { name: 'Nation' })).toBeVisible({ timeout: 5000 });
  });

  test('shows agent name input', async ({ page }) => {
    await page.goto('/agents/new');

    await expect(page.getByLabel('Agent Name')).toBeVisible();
  });

  test('creates a new agent with valid data', async ({ page }) => {
    // ── Ensure there's room under the 10-agent quota ──────────
    // Delete any previous "E2E Test Agent" to free a slot.
    const listRes = await page.request.get('/api/agents?q=E2E+Test+Agent&limit=50');
    if (listRes.ok()) {
      const { agents } = await listRes.json() as { agents: { id: string; displayName: string }[] };
      for (const a of agents.filter((a) => a.displayName === 'E2E Test Agent')) {
        await page.request.delete(`/api/agents/${a.id}`);
      }
    }

    await page.goto('/agents/new', { timeout: 45_000, waitUntil: 'domcontentloaded' });

    // Wait for nations to load
    await page.waitForTimeout(1500);

    // Fill in agent name
    await page.getByLabel('Agent Name').fill('E2E Test Agent');

    // Select the CLAW nation via Radix Select (MOLT is carrier-type, owned by
    // systemUser — demo user cannot create agents under it)
    await page.getByRole('combobox', { name: 'Nation' }).click();
    await page.getByRole('option', { name: /CLAW/ }).click();

    // Submit the form
    await page.getByRole('button', { name: /claim moltnumber/i }).click();

    // Should see the success state: "Your MoltNumber is ready"
    await expect(page.getByText('Your MoltNumber is ready')).toBeVisible({ timeout: 30_000 });

    // Should also show the private key (MoltSIM) on the same success page
    await expect(page.getByText(/MoltSIM Private Key/)).toBeVisible();
  });
});

test.describe('Agent detail page', () => {
  test('shows agent info on detail page', async ({ page }) => {
    // Navigate to My Agents first, then click into one
    await page.goto('/agents');

    // Wait for agents to load — click the first agent card/link
    const agentLink = page.getByRole('link').filter({ hasText: /MPHO-|CLAW-/ }).first();
    if (await agentLink.isVisible({ timeout: 10_000 })) {
      await agentLink.click();
      await page.waitForLoadState('domcontentloaded');

      // Should see agent details — the detail page shows a "Copy MoltNumber" button
      await expect(page.getByRole('main').getByRole('button', { name: 'Copy MoltNumber' })).toBeVisible({ timeout: 15_000 });
    }
  });
});
