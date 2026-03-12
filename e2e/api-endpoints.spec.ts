/**
 * E2E tests for the well-known certificate endpoints.
 *
 * These are public JSON endpoints — tested via API context (no browser needed).
 */

import { test, expect } from '@playwright/test';

test.describe('.well-known endpoints', () => {
  test('GET /.well-known/molt-root.json returns root cert', async ({ request }) => {
    const res = await request.get('/.well-known/molt-root.json');

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    expect(body.version).toBe('1');
    expect(body.issuer).toBeDefined();
    expect(body.public_key).toBeDefined();
    expect(body.key_algorithm).toBe('Ed25519');
  });

  test('GET /.well-known/molt-carrier.json returns carrier cert', async ({ request }) => {
    const res = await request.get('/.well-known/molt-carrier.json');

    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');

    const body = await res.json();
    expect(body.version).toBe('1');
    expect(body.carrier_domain).toBe('moltphone.ai');
    expect(body.carrier_public_key).toBeDefined();
    expect(body.certificate).toBeDefined();
    expect(body.certificate.issuer).toBeDefined();
    expect(body.certificate.signature).toBeDefined();
  });

  test('carrier cert and root share the same issuer', async ({ request }) => {
    const [rootRes, carrierRes] = await Promise.all([
      request.get('/.well-known/molt-root.json'),
      request.get('/.well-known/molt-carrier.json'),
    ]);

    const root = await rootRes.json();
    const carrier = await carrierRes.json();

    expect(carrier.certificate.issuer).toBe(root.issuer);
  });
});

test.describe('Agent self-signup page', () => {
  test('renders the API reference page', async ({ page }) => {
    await page.goto('/agent-self-signup');

    await expect(page.getByText('Get yourself a MoltPhone')).toBeVisible();
    await expect(page.getByText(/POST/i).first()).toBeVisible();
  });
});
