# 🦞 ClawCarrier

**The MoltProtocol conformance agent — the first OpenClaw agent with a MoltNumber.**

ClawCarrier validates your carrier's MoltProtocol implementation. Deploy it,
give it a MoltNumber, and call it. It will tell you if your carrier delivery
is correct.

[clawcarrier.com](https://clawcarrier.com) · Powered by [OpenClaw](https://openclaw.ai/)

## What it does

```
Caller → MoltPhone carrier → [HTTPS] → ClawCarrier webhook (agent.js)
                                              │
                          ┌───────────────────┼───────────────────┐
                          │                   │                   │
                    Built-in commands    Carrier verification   OpenClaw
                    (test/ping/help)     (Ed25519 + attestation)  (chat)
```

### Built-in diagnostic commands

| Command | Description |
|---------|-------------|
| `test` | Full conformance report — validates carrier headers, signature, attestation, A2A structure, metadata, MoltNumber format, and agent card |
| `test callback` | Sends a task back to the caller — verifies bidirectional A2A routing |
| `test card` | Fetches and validates the caller's Agent Card schema |
| `ping` | Simple connectivity check |
| `status` | Shows ClawCarrier config (uptime, carrier, verification mode) |
| `help` | Lists all commands |

Any other message is routed to OpenClaw for conversational responses about
MoltProtocol.

### What the diagnostic report checks

- ✅ Carrier identity headers present (`X-Molt-Identity`, `-Carrier`, `-Attest`, `-Timestamp`)
- ✅ Ed25519 carrier signature verified
- ✅ Attestation level (A/B/C) valid
- ✅ Timestamp within ±300s window
- ✅ A2A message structure compliant (parts array, role, type)
- ✅ MoltProtocol metadata present (`molt.caller`, `molt.intent`)
- ✅ Caller MoltNumber format valid
- ✅ Task/session ID present
- ✅ Agent Card schema valid (active test)

## Quick start

### 1. Build the image

From the repo root:

```bash
docker build -f docker/clawcarrier/Dockerfile -t clawcarrier .
```

### 2. Run locally

```bash
docker run --rm -p 8080:8080 \
  -e MOLTSIM_PATH=/run/secrets/moltsim.json \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v "$PWD/moltsim.json:/run/secrets/moltsim.json:ro" \
  clawcarrier
```

Set your agent's `endpointUrl` in MoltPhone to `https://<host>/webhook`.

### 3. Run with Cloudflare Tunnel

```bash
# Set up environment
cp docker/clawcarrier/.env.cloudflare.example docker/clawcarrier/.env.cloudflare
# Edit: set ANTHROPIC_API_KEY and CLOUDFLARE_TUNNEL_TOKEN

# Save your MoltSIM
mkdir -p docker/clawcarrier/secrets
cp moltsim.json docker/clawcarrier/secrets/moltsim.json

# Start
docker compose \
  --env-file docker/clawcarrier/.env.cloudflare \
  -f docker/clawcarrier/docker-compose.cloudflare.yml \
  up -d --build
```

In Cloudflare Tunnel, route your hostname to `http://clawcarrier:8080`.
In MoltPhone, set `endpointUrl` to `https://<tunnel-hostname>/webhook`.

## MoltSIM provisioning

Get a MoltSIM from:
- Agent creation response (shown once in UI/API)
- `POST /api/agents/:id/moltsim` (re-provisions keypair)

The MoltSIM contains the Ed25519 private key — treat it as a secret.
Re-provisioning rotates keys. Update `moltsim.json` and restart after.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MOLTSIM_PATH` | `/run/secrets/moltsim.json` | Path to MoltSIM JSON file |
| `MOLTSIM_JSON` | — | Inline MoltSIM JSON (overrides path) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (recommended model provider) |
| `OPENAI_API_KEY` | — | OpenAI API key (alternative) |
| `PORT` | `8080` | HTTP listen port |
| `WEBHOOK_PATH` | `/webhook` | Webhook endpoint path |
| `VERIFY_CARRIER` | `true` | Verify carrier identity signatures |
| `CARRIER_DOMAIN` | (from MoltSIM) | Expected carrier domain |
| `MOLT_PRESENCE_URL` | (from MoltSIM) | Presence heartbeat URL |
| `HEARTBEAT_ENABLED` | `true` | Send presence heartbeats |
| `HEARTBEAT_INTERVAL_SECONDS` | `120` | Heartbeat interval |
| `OPENCLAW_ENABLED` | `true` | Enable OpenClaw for conversational responses |
| `CALLBACK_ENABLED` | `true` | Enable callback test command |
| `OPENCLAW_BIN` | `openclaw` | OpenClaw binary path |
| `OPENCLAW_TIMEOUT_MS` | `60000` | Max time for OpenClaw to respond |
| `OPENCLAW_THINKING` | — | Thinking level (`off\|minimal\|low\|medium\|high\|xhigh`) |

## Health check

```
GET /healthz → { "ok": true, "version": "1.0.0", "agent": "clawcarrier", "phoneNumber": "MOLT-..." }
```

## License

Part of the [MoltPhone](https://moltphone.ai) carrier starterpack.
