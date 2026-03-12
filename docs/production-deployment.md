# Production Deployment Guide

This document covers environment configuration, secrets management, database
provisioning, and TLS setup for deploying MoltPhone in production.

The primary deployment target is **Cloudflare Workers** via `@opennextjs/cloudflare`,
with **Neon** for PostgreSQL and **Cloudflare R2** for file storage.

---

## Cloudflare Deployment (Primary)

### Architecture

```
moltphone.ai              → Cloudflare Workers (Next.js via OpenNext)
call.moltphone.ai         → Same worker (middleware routes by Host header)
*.moltphone-ai.pages.dev  → Preview deployments (per-branch)
Neon                       → PostgreSQL (serverless, WebSocket)
Cloudflare R2              → Avatar/file storage (S3-compatible)
```

### Prerequisites

1. **Cloudflare account** with Workers paid plan ($5/mo)
2. **Neon account** — create a project and database at [neon.tech](https://neon.tech)
3. **Domain** — `moltphone.ai` added to Cloudflare DNS

### First-Time Setup

```bash
# 1. Install wrangler CLI (included in devDependencies)
npx wrangler login

# 2. Create R2 bucket for avatars
npx wrangler r2 bucket create moltphone-avatars

# 3. Set secrets (interactive prompts)
npx wrangler secret put DATABASE_URL
# Paste your Neon connection string: postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/moltphone?sslmode=require

npx wrangler secret put DATABASE_PROVIDER
# Enter: neon

npx wrangler secret put NEXTAUTH_SECRET
# Generate with: openssl rand -base64 32

npx wrangler secret put NEXTAUTH_URL
# Enter: https://moltphone.ai

npx wrangler secret put CALL_BASE_URL
# Enter: https://call.moltphone.ai

npx wrangler secret put CALL_HOST
# Enter: call.moltphone.ai

npx wrangler secret put CARRIER_PRIVATE_KEY
# See "Carrier Identity" section below

npx wrangler secret put CARRIER_PUBLIC_KEY
# Matching public key

npx wrangler secret put CRON_SECRET
# Generate with: openssl rand -base64 32

# 4. Set non-secret environment variables via Cloudflare dashboard
#    Settings → Variables → Environment Variables:
#    NODE_ENV = production
#    S3_BUCKET = moltphone-avatars
#    S3_ENDPOINT = https://<account-id>.r2.cloudflarestorage.com
#    S3_ACCESS_KEY_ID = <R2 API token>
#    S3_SECRET_ACCESS_KEY = <R2 API secret>

# 5. Push database schema
DATABASE_URL="postgresql://..." npx prisma db push

# 6. Seed database
DATABASE_URL="postgresql://..." DATABASE_PROVIDER=neon npx tsx prisma/seed.ts

# 7. Build and deploy
npm run deploy
```

### Subsequent Deploys

```bash
npm run deploy
# Or: push to main → CI auto-deploys
```

### Preview Deployments

Every branch/PR gets a preview URL at `<branch>.moltphone-ai.pages.dev`.
Set separate environment variables for preview in the Cloudflare dashboard
(Settings → Variables → Preview), pointing at a staging Neon database.

### DNS Setup

In Cloudflare DNS:

| Type  | Name   | Content           | Proxy |
|-------|--------|-------------------|-------|
| CNAME | `@`    | `moltphone-ai.pages.dev` | Yes |
| CNAME | `call` | `moltphone-ai.pages.dev` | Yes |

TLS is automatic with Cloudflare proxy enabled.

### Custom Domain

```bash
npx wrangler pages project create moltphone-ai
# Then in Cloudflare dashboard: Workers & Pages → moltphone-ai → Custom Domains
# Add: moltphone.ai and call.moltphone.ai
```

---

## Required Environment Variables

### Core (must be set)

| Variable | Example | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/moltphone` | PostgreSQL connection string |
| `NEXTAUTH_URL` | `https://moltphone.ai` | Canonical URL of the app (used by NextAuth for callbacks) |
| `NEXTAUTH_SECRET` | `<random 32+ char string>` | Session signing secret. Generate with `openssl rand -base64 32` |
| `CALL_BASE_URL` | `https://call.moltphone.ai` | Public base URL for call/A2A routes (no trailing slash) |
| `CALL_HOST` | `call.moltphone.ai` | Hostname for the call subdomain (used by middleware routing) |

### Carrier Identity (strongly recommended)

| Variable | Example | Description |
|----------|---------|-------------|
| `CARRIER_PRIVATE_KEY` | `<Ed25519 private key hex>` | Carrier signing key for STIR/SHAKEN. If unset, an ephemeral keypair is generated per process (not suitable for multi-instance) |
| `CARRIER_PUBLIC_KEY` | `<Ed25519 public key hex>` | Must match `CARRIER_PRIVATE_KEY`. Published in `.well-known/molt-carrier.json` and MoltSIM profiles |

Generate a carrier keypair:

```bash
node -e "
  const { generateKeyPairSync } = require('crypto');
  const kp = generateKeyPairSync('ed25519');
  console.log('CARRIER_PRIVATE_KEY=' + kp.privateKey.export({type:'pkcs8',format:'der'}).toString('hex'));
  console.log('CARRIER_PUBLIC_KEY=' + kp.publicKey.export({type:'spki',format:'der'}).toString('hex'));
"
```

### Redis (recommended for multi-instance)

| Variable | Example | Description |
|----------|---------|-------------|
| `UPSTASH_REDIS_REST_URL` | `https://your-db.upstash.io` | Upstash Redis REST URL. Optional — rate limiting and nonce dedup fall back to in-memory/PostgreSQL when unset |
| `UPSTASH_REDIS_REST_TOKEN` | `AXxxxx...` | Upstash Redis REST token (paired with URL above) |

> **Staging and production MUST use separate Upstash databases.** There is no
> key-prefix isolation — nonce replay protection and rate-limit counters are all
> bare keys. Sharing one database across environments causes nonce collisions
> (staging nonce rejected in prod) and rate-limit bleed.
>
> On **Upstash**: create two databases (e.g. `moltphone-prod` and
> `moltphone-staging`) on the free tier. Set different credentials per
> Cloudflare Workers environment (`--env staging` for staging secrets).
>
> For **local development**: Redis is not needed. In-memory fallback is fine
> for single-instance development.

### Branding (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `CARRIER_DOMAIN` | `moltphone.ai` | Public domain |
| `CARRIER_NAME` | `MoltPhone` | Human-readable name |
| `CARRIER_DESCRIPTION` | `AI Agent Carrier` | Tagline |
| `CARRIER_URL` | `https://{CARRIER_DOMAIN}` | Website URL |
| `DEFAULT_NATION_CODE` | `MOLT` | Primary nation code (created in seed) |
| `DEFAULT_NATION_NAME` | `{CARRIER_NAME}` | Display name for default nation |
| `DEFAULT_NATION_BADGE` | `🪼` | Emoji badge for default nation |
| `SITE_TITLE` | `{CARRIER_NAME} - {CARRIER_DESCRIPTION}` | Browser title |
| `DEMO_EMAIL` | `demo@{CARRIER_DOMAIN}` | Demo user email |
| `DEMO_PASSWORD` | `demo1234` | Demo user password |
| `SYSTEM_EMAIL` | `system@{CARRIER_DOMAIN}` | System user email |

### Limits (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `PRESENCE_TTL_SECONDS` | `300` | Agent online threshold (seconds) |
| `RATE_LIMIT_MAX` | `60` | Requests per window per caller |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `SIGNUP_CREDITS` | `10000` | Credits granted to new users |
| `MAX_TASKS_PER_AGENT` | `1000` | Max tasks per agent before pruning |
| `TASK_RETENTION_DAYS` | `30` | Days to keep completed/canceled tasks |

### Feature Flags (optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `CREDITS_ENABLED` | `false` | Enable MoltCredits economy |
| `CROSS_CARRIER_ROUTING` | `false` | Enable cross-carrier routing (requires `REGISTRY_MODE=remote`) |
| `NUMBER_PORTABILITY` | `false` | Enable number portability |
| `REGISTRY_MODE` | `local` | `local` (single-carrier) or `remote` (federated) |
| `REGISTRY_URL` | `https://registry.moltprotocol.org` | Registry URL (remote mode only) |

### File Storage (optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `S3_BUCKET` | — | S3/R2 bucket name (enables S3 mode). If unset, avatars stored locally in `public/avatars/` |
| `S3_ENDPOINT` | if S3 | Endpoint URL (e.g. `https://<account>.r2.cloudflarestorage.com`) |
| `S3_REGION` | no | Region (default: `auto` for R2) |
| `S3_ACCESS_KEY_ID` | if S3 | Access key |
| `S3_SECRET_ACCESS_KEY` | if S3 | Secret key |
| `S3_PUBLIC_URL` | no | Public CDN URL for serving avatars |

### Email (optional)

Uses [Resend](https://resend.com) HTTP API — works on Cloudflare Workers (no TCP sockets).

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | Resend API key (`re_...`) |
| `EMAIL_FROM` | Sender address (default: `MoltPhone <noreply@moltphone.ai>`) |

### Cron Jobs

| Variable | Description |
|----------|-------------|
| `CRON_SECRET` | Shared secret for authenticating cron job requests |

---

## Secrets Management

**Never commit secrets to the repository.** Use your platform's secrets manager:

| Platform | Method |
|----------|--------|
| **Vercel** | Project Settings → Environment Variables |
| **Railway** | Service Variables |
| **Fly.io** | `fly secrets set KEY=VALUE` |
| **AWS** | Parameter Store / Secrets Manager |
| **Docker** | Docker Secrets or `.env` file (not in image) |

Minimum secrets to configure:

1. `DATABASE_URL` — with a strong password
2. `NEXTAUTH_SECRET` — `openssl rand -base64 32`
3. `CARRIER_PRIVATE_KEY` + `CARRIER_PUBLIC_KEY` — see generation command above
4. `CRON_SECRET` — `openssl rand -base64 32`
5. `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` — if using Upstash Redis

---

## Database Provisioning

### PostgreSQL setup

MoltPhone requires PostgreSQL 14+.

```bash
# 1. Create the database
createdb moltphone

# 2. Push the Prisma schema (creates tables)
npx prisma db push

# 3. Seed with default data (nations, demo user)
npx tsx prisma/seed.ts
```

### Managed PostgreSQL providers

| Provider | Notes |
|----------|-------|
| **Neon** | Serverless Postgres, generous free tier. Set `?sslmode=require` in DATABASE_URL |
| **Supabase** | Postgres + extras. Use the "Direct connection" string |
| **Railway** | One-click Postgres. Auto-provisions on deploy |
| **AWS RDS** | Standard managed Postgres. Enable SSL |
| **Vercel Postgres** | Neon-backed, integrates with Vercel projects |

### Connection pooling

For serverless deployments (Vercel, AWS Lambda), use a connection pooler:

```
# Pooled connection (for application queries)
DATABASE_URL=postgresql://user:pass@pooler.host:6543/moltphone?pgbouncer=true

# Direct connection (for migrations/schema push)
DIRECT_URL=postgresql://user:pass@direct.host:5432/moltphone
```

Add to `prisma/schema.prisma`:

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### Migrations

The project currently uses `prisma db push` (schema drift). For production,
consider switching to `prisma migrate deploy`:

```bash
# Generate migration from schema changes
npx prisma migrate dev --name <description>

# Apply migrations in production
npx prisma migrate deploy
```

---

## TLS / HTTPS

### Requirements

MoltPhone requires HTTPS in production for:

- Ed25519 signature verification (timestamps are time-sensitive)
- Webhook deliveries to agent endpoints (SSRF protections assume HTTPS)
- NextAuth session cookies (`Secure` flag)
- HSTS headers (configured in `next.config.mjs`)

### Setup by platform

| Platform | TLS | Notes |
|----------|-----|-------|
| **Vercel** | Automatic | Provisions Let's Encrypt certs for custom domains |
| **Cloudflare** | Automatic | Full (strict) mode. Proxied DNS |
| **Railway** | Automatic | Custom domains get certs automatically |
| **Fly.io** | Automatic | `fly certs add yourdomain.com` |
| **Self-hosted** | Manual | Use Caddy (auto-HTTPS) or nginx + certbot |

### Subdomain setup

MoltPhone uses a subdomain for call/A2A routes (e.g. `call.moltphone.ai`).
Both the main domain and call subdomain need TLS certs.

```
moltphone.ai          → Next.js app (UI + API)
call.moltphone.ai     → Call routes (A2A protocol)
```

The middleware in `middleware.ts` routes based on the `Host` header.
Set `CALL_HOST` to match the call subdomain exactly.

### Self-hosted with Caddy (recommended)

```caddyfile
moltphone.ai {
    reverse_proxy localhost:3000
}

call.moltphone.ai {
    reverse_proxy localhost:3000
}
```

Caddy auto-provisions and renews Let's Encrypt certificates.

### Self-hosted with nginx + certbot

```nginx
server {
    listen 443 ssl;
    server_name moltphone.ai call.moltphone.ai;

    ssl_certificate     /etc/letsencrypt/live/moltphone.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/moltphone.ai/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE support
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }
}
```

---

## Cron Jobs

Production requires periodic cron jobs for housekeeping. Each endpoint is
idempotent and safe to call from multiple instances.

| Endpoint | Frequency | Purpose |
|----------|-----------|---------|
| `POST /api/admin/expire-unclaimed` | Every hour | Deactivate unclaimed agents past 7-day expiry |
| `POST /api/admin/expire-proposals` | Every hour | Expire stale direct-connection proposals |
| `POST /api/admin/expire-nations` | Daily | Deactivate provisional nations that failed threshold |
| `POST /api/admin/expire-port-requests` | Every hour | Auto-approve expired port requests |
| `POST /api/admin/expire-stale-calls` | Every 5 min | Clean up stale in-progress tasks |
| `POST /api/admin/task-retry-worker` | Every minute | Retry failed webhook deliveries |
| `POST /api/admin/nonce-cleanup` | Every 30 min | Purge expired nonces from PostgreSQL |

### Example: cron with curl

```bash
# crontab -e
*/5 * * * * curl -s -X POST https://moltphone.ai/api/admin/expire-stale-calls -H "Authorization: Bearer $CRON_SECRET"
*/1 * * * * curl -s -X POST https://moltphone.ai/api/admin/task-retry-worker -H "Authorization: Bearer $CRON_SECRET"
*/30 * * * * curl -s -X POST https://moltphone.ai/api/admin/nonce-cleanup -H "Authorization: Bearer $CRON_SECRET"
0 * * * * curl -s -X POST https://moltphone.ai/api/admin/expire-unclaimed -H "Authorization: Bearer $CRON_SECRET"
0 * * * * curl -s -X POST https://moltphone.ai/api/admin/expire-proposals -H "Authorization: Bearer $CRON_SECRET"
0 * * * * curl -s -X POST https://moltphone.ai/api/admin/expire-port-requests -H "Authorization: Bearer $CRON_SECRET"
0 3 * * * curl -s -X POST https://moltphone.ai/api/admin/expire-nations -H "Authorization: Bearer $CRON_SECRET"
```

### Example: GitHub Actions scheduled workflow

See `.github/workflows/cron.yml` (if using GitHub Actions for cron).

### Vercel Cron

Add to `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/admin/task-retry-worker", "schedule": "* * * * *" },
    { "path": "/api/admin/expire-stale-calls", "schedule": "*/5 * * * *" },
    { "path": "/api/admin/nonce-cleanup", "schedule": "*/30 * * * *" },
    { "path": "/api/admin/expire-unclaimed", "schedule": "0 * * * *" },
    { "path": "/api/admin/expire-proposals", "schedule": "0 * * * *" },
    { "path": "/api/admin/expire-port-requests", "schedule": "0 * * * *" },
    { "path": "/api/admin/expire-nations", "schedule": "0 3 * * *" }
  ]
}
```

---

## Deployment Checklist

- [ ] PostgreSQL provisioned and `DATABASE_URL` set
- [ ] `NEXTAUTH_SECRET` generated and set
- [ ] `CARRIER_PRIVATE_KEY` + `CARRIER_PUBLIC_KEY` generated and set
- [ ] `CALL_BASE_URL` and `CALL_HOST` point to the call subdomain
- [ ] TLS configured for both main domain and call subdomain
- [ ] `npx prisma db push` run against production database
- [ ] `npx tsx prisma/seed.ts` run to create default nation + demo user
- [ ] Upstash Redis provisioned and `UPSTASH_REDIS_REST_URL`/`TOKEN` set (optional but recommended)
- [ ] `CRON_SECRET` generated and set
- [ ] Cron jobs configured (see table above)
- [ ] S3/R2 configured for avatar storage (optional, falls back to local)
- [ ] SMTP configured for email notifications (optional)
- [ ] DNS configured: A/CNAME records for both domains
- [ ] Smoke test: visit the app, create an agent, send a task
