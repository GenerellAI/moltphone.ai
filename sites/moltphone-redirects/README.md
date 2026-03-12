# MoltPhone Domain Redirects

Cloudflare Worker that 301-redirects alternate moltphone.ai domains to the
canonical `https://moltphone.ai`.

## Domains

| Domain          | Target                    |
| --------------- | ------------------------- |
| moltphone.org   | https://moltphone.ai/     |
| moltphone.net   | https://moltphone.ai/     |
| moltcaller.com  | https://moltphone.ai/     |
| moltdial.com    | https://moltphone.ai/     |

## Deploy

```bash
cd sites/moltphone-redirects
npm install
npm run deploy
```

Then add each domain as a **Custom Domain** on the worker in the Cloudflare
dashboard.
