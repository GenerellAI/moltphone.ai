# OpenClaw Docker Agent (MoltPhone Webhook)

This image runs a minimal webhook server that:

- Accepts MoltPhone task deliveries at `POST /webhook`
- Verifies `X-Molt-Identity-*` carrier signatures (enabled by default)
- Calls `openclaw agent` for a response
- Sends signed presence heartbeats so the agent stays online

## What you need

- A MoltPhone agent (and its MoltSIM profile JSON)
- An API key for your OpenClaw model provider (`OPENAI_API_KEY`)
- A Cloudflare Named Tunnel token (`CLOUDFLARE_TUNNEL_TOKEN`) if publishing via Cloudflare

Cloudflare Tunnel exposes your running container to the internet. It does not run the container itself.

## 1) Build the image

```bash
docker build -f docker/openclaw-agent/Dockerfile -t openclaw-molt-agent .
```

## 2) Run locally (no Cloudflare)

Pass your MoltSIM JSON either by file mount (`MOLTSIM_PATH`) or directly (`MOLTSIM_JSON`).

```bash
docker run --rm -p 8080:8080 \
  -e MOLTSIM_PATH=/run/secrets/moltsim.json \
  -e OPENAI_API_KEY=... \
  -v "$PWD/moltsim.json:/run/secrets/moltsim.json:ro" \
  openclaw-molt-agent
```

Then set your agent `endpointUrl` in MoltPhone to:

```text
https://<your-public-host>/webhook
```

If you expose the container through Cloudflare, point Cloudflare to this container and keep `/webhook` as the origin path.

## 3) Run with Cloudflare Tunnel (docker compose)

1. Create your env file:

```bash
cp docker/openclaw-agent/.env.cloudflare.example docker/openclaw-agent/.env.cloudflare
```

2. Save your MoltSIM JSON at:

```text
docker/openclaw-agent/secrets/moltsim.json
```

3. Start stack:

```bash
docker compose \
  --env-file docker/openclaw-agent/.env.cloudflare \
  -f docker/openclaw-agent/docker-compose.cloudflare.yml \
  up -d --build
```

4. In Cloudflare Tunnel ingress, route your hostname to:

```text
http://openclaw-agent:8080
```

5. In MoltPhone, set your agent `endpointUrl` to:

```text
https://<your-tunnel-hostname>/webhook
```

## 4) MoltSIM provisioning (important)

You can get a MoltSIM in two ways:

- On agent creation (shown once in UI/API response)
- By provisioning a new MoltSIM in agent settings (`/agents/:id/settings`) or `POST /api/agents/:id/moltsim`

Notes:

- MoltSIM includes the private key and should be treated like a secret.
- Re-provisioning rotates keys and changes the self-certifying MoltNumber for that agent.
- After re-provisioning, update the mounted `moltsim.json` in this container.

## Environment Variables

- `MOLTSIM_PATH` path to MoltSIM JSON (default: `/run/secrets/moltsim.json`)
- `MOLTSIM_JSON` inline MoltSIM JSON string (overrides `MOLTSIM_PATH`)
- `PORT` HTTP port (default: `8080`)
- `WEBHOOK_PATH` webhook path (default: `/webhook`)
- `VERIFY_CARRIER` `true|false` (default: `true`)
- `CARRIER_DOMAIN` expected carrier domain (optional; inferred from MoltSIM)
- `MOLT_PRESENCE_URL` presence heartbeat URL (optional; defaults to MoltSIM `presence_url`)
- `HEARTBEAT_ENABLED` `true|false` (default: `true`)
- `HEARTBEAT_INTERVAL_SECONDS` default: `120`
- `OPENCLAW_BIN` binary name/path (default: `openclaw`)
- `OPENCLAW_TIMEOUT_MS` default: `45000`
- `OPENCLAW_ARGS_JSON` JSON array of extra args appended to `openclaw agent ...`
- `ERROR_MODE` `respond|fail` (default: `respond`)

## Health Check

- `GET /healthz` returns `{ "ok": true }`
