/**
 * Tests for SSRF protection in webhook URL validation.
 */
import { validateWebhookUrl } from '../lib/ssrf';

describe('SSRF Protection', () => {
  it('allows public HTTPS URL', async () => {
    const result = await validateWebhookUrl('https://example.com/webhook');
    expect(result.ok).toBe(true);
  });

  it('allows public HTTP URL', async () => {
    const result = await validateWebhookUrl('http://example.com/webhook');
    expect(result.ok).toBe(true);
  });

  it('rejects non-http protocols', async () => {
    const result = await validateWebhookUrl('ftp://example.com/file');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/http/i);
  });

  it('rejects file protocol', async () => {
    const result = await validateWebhookUrl('file:///etc/passwd');
    expect(result.ok).toBe(false);
  });

  it('rejects invalid URL', async () => {
    const result = await validateWebhookUrl('not-a-url');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Invalid URL/i);
  });

  // Private IP ranges — direct IP literals
  it('blocks 127.0.0.1 (localhost)', async () => {
    const result = await validateWebhookUrl('http://127.0.0.1/hook');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/private/i);
  });

  it('blocks 127.x.x.x range', async () => {
    const result = await validateWebhookUrl('http://127.0.0.2/hook');
    expect(result.ok).toBe(false);
  });

  it('blocks 10.x.x.x (Class A private)', async () => {
    const result = await validateWebhookUrl('http://10.0.0.1/hook');
    expect(result.ok).toBe(false);
  });

  it('blocks 192.168.x.x (Class C private)', async () => {
    const result = await validateWebhookUrl('http://192.168.1.1/hook');
    expect(result.ok).toBe(false);
  });

  it('blocks 172.16-31.x.x (Class B private)', async () => {
    const result = await validateWebhookUrl('http://172.16.0.1/hook');
    expect(result.ok).toBe(false);
    const result2 = await validateWebhookUrl('http://172.31.255.255/hook');
    expect(result2.ok).toBe(false);
  });

  it('blocks 169.254.x.x (link-local)', async () => {
    const result = await validateWebhookUrl('http://169.254.169.254/latest');
    expect(result.ok).toBe(false);
  });

  it('blocks 0.x.x.x', async () => {
    const result = await validateWebhookUrl('http://0.0.0.0/hook');
    expect(result.ok).toBe(false);
  });

  it('blocks IPv6 loopback ::1', async () => {
    const result = await validateWebhookUrl('http://[::1]/hook');
    expect(result.ok).toBe(false);
  });

  it('allows non-private IP', async () => {
    const result = await validateWebhookUrl('http://8.8.8.8/hook');
    expect(result.ok).toBe(true);
  });
});
