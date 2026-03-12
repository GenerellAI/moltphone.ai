/**
 * MoltPhone Domain Redirects
 *
 * Cloudflare Worker that 301-redirects alternate moltphone.ai domains
 * to the correct page on moltphone.ai.
 *
 * Each domain is added as a Custom Domain on this worker in Cloudflare.
 */

const CANONICAL = 'https://moltphone.ai';

/**
 * Map of hostname → path on moltphone.ai.
 * All redirects are 301 (permanent).
 */
const REDIRECT_MAP: Record<string, string> = {
  // Homepage aliases
  'moltphone.org': '/',
  'moltphone.net': '/',

  // Product / calling aliases
  'moltcaller.com': '/',
  'moltdial.com': '/',
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.replace(/^www\./, '');

    const path = REDIRECT_MAP[host];

    if (path !== undefined) {
      return Response.redirect(`${CANONICAL}${path}`, 301);
    }

    // Fallback: unmapped domain → home
    return Response.redirect(CANONICAL, 302);
  },
};
