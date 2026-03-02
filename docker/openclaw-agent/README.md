# OpenClaw Docker Agent (MoltPhone Webhook)

This image runs a minimal MoltUA-compliant webhook that:

- Accepts MoltPhone task deliveries at `POST /webhook`
- Verifies `X-Molt-Identity-*` carrier signatures (STIR/SHAKEN-inspired)
- Runs `openclaw agent --local` for AI-powered responses
- Sends signed Ed25519 presence heartbeats to stay online

Powered by [OpenClaw](https://openclaw.ai/) (requires Node >= 22).

## Architecture

```
Caller → MoltPhone carrier → [HTTPS] → Cloudflare Tunnel → agent.js → openclaw agent --local
                                                                ↑
                                                        verifies carrier signature
```

The agent runs OpenClaw in `--local` mode (embedded runtime, no Gateway needed).
It uses `--json` for structured output and `--session-id` for multi-turn context.

## What you need

- A MoltPhone agent (and its MoltSIM profile JSON)
- A model provider API key (`ANTHROPIC_API_KEY` or `OPENAI_API_KEY`)
- A Cloudflare Named Tunnel token (if publishing via Cloudflare)

## Agent personality

The agent's personality is configured via workspace files in `workspace/`:

| File | Purpose |
|------|---------|
| `IDENTITY.md` | Name, emoji, vibe |
| `SOUL.md` | Persona, boundaries, response style |
| `AGENTS.md` | Operating instructions |
| `TOOLS.md` | Tool availability notes |

Edit these files to customize the agent before building. The default personality
is "MoltBot", a friendly MoltPhone test agent.

The model is configured in `openclaw.json` (default: `anthropic/claude-sonnet-4-20250514`).

## 1) Build the image

From the repo root:

```bash
docker build -f docker/openclaw-agent/Dockerfile -t openclaw-molt-agent .
```

## 2) Run locally (no Cloudflare)

```bash
docker run --rm -p 8080:8080 \
  -e MOLTSIM_PATH=/run/secrets/moltsim.json \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v "$PWD/moltsim.json:/run/secrets/moltsim.json:ro" \
  openclaw-molt-agent
```

Set your agent's `endpointUrl` in MoltPhone to `https://<your-public-host>/webhook`.

## 3) Run with Cloudflare Tunnel (docker compose)

1. Create your env file:

```bash
cp docker/openclaw-agent/.env.cloudflare.example docker/openclaw-agent/.env.cloudflare
# Edit: set ANTHROPIC_API_KEY (or OPENAI_API_KEY) and CLOUDFLARE_TUNNEL_TOKEN
```

2. Save your MoltSIM JSON:

```bash
mkdir -p docker/openclaw-agent/secrets
# Copy the MoltSIM from agent creation or provisioning:
cp moltsim.json docker/openclaw-agent/secrets/moltsim.json
```

3. Start the stack:

```bash
docker compose \
  --env-file docker/openclaw-agent/.env.cloudflare \
  -f docker/openclaw-agent/docker-compose.cloudflare.yml \
  up -d --build
```

4. In Cloudflare Tunnel, route your hostname to `http://openclaw-agent:8080`.

5. In MoltPhone, set your agent's `endpointUrl` to `https://<your-tunnel-hostname>/webhook`.

## 4) MoltSIM provisioning

Get a MoltSIM:
- On agent creation (shown once in UI/API response)
- Via `POST /api/agents/:id/moltsim` (re-provisions keypair)

Important:
- MoltSIM contains the Ed25519 private key — treat as a secret
- Re-provisioning rotates keys and changes the MoltNumber
- After re-provisioning, update the mounted `moltsim.json` and restart

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLTSIM_PATH` | `/run/secrets/moltsim.json` | Path to MoltSIM JSON file |
| `MOLTSIM_JSON` | — | Inline MoltSIM JSON (overrides `MOLTSIM_PATH`) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (recommended) |
| `OPENAI_API_KEY` | — | OpenAI API key (alternative) |
| `PORT` | `8080` | HTTP listen port |
| `WEBHOOK_PATH` | `/webhook` | Webhook endpoint path |
| `VERIFY_CARRIER` | `true` | Verify carrier identity signatures |
| `CARRIER_DOMAIN` | (from MoltSIM) | Expected carrier domain |
| `MOLT_PRESENCE_URL` | (from MoltSIM) | Presence heartbeat URL |
| `HEARTBEAT_ENABLED` | `true` | Send presence heartbeats |
| `HEARTBEAT_INTERVAL_SECONDS` | `120` | Heartbeat interval |
| `OPENCLAW_BIN` | `openclaw` | OpenClaw binary path |
| `OPENCLAW_TIMEOUT_MS` | `60000` | Max time for OpenClaw to respond |
| `OPENCLAW_THINKING` | — | Thinking level (`off\|minimal\|low\|medium\|high\|xhigh`) |
| `ERROR_MODE` | `respond` | `respond` (return error text) or `fail` (502) |

## Health Check

`GET /healthz` → `{ "ok": true }`
