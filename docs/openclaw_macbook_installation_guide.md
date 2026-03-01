Here’s the same “MacBook sandboxed OpenClaw” guide, cleaned up so you can paste/send it.

⸻

Sandboxed OpenClaw on macOS (host gateway + Docker tool sandbox)

What this setup gives you
	•	OpenClaw Gateway runs on your Mac only on localhost
	•	Tool execution happens in a Docker sandbox container
	•	No host “elevated/exec” escape hatch
	•	Sandbox has no access to your real files by default (workspaceAccess: none)
	•	Minimal tool surface: only exec allowed

⸻

1) Install prerequisites

Docker

Install Docker Desktop and verify:

docker run --rm hello-world

Node + OpenClaw

Install OpenClaw via npm:

npm install -g openclaw@latest
openclaw --version
which openclaw


⸻

2) Initialize OpenClaw state + lock down permissions

Run doctor once to create needed dirs:

openclaw doctor

Lock down state + config permissions (important):

chmod 700 ~/.openclaw
chmod 600 ~/.openclaw/openclaw.json

Verify:

openclaw security audit


⸻

3) Configure OpenClaw for sandboxed tools (no host exec)

Disable elevated/host tools:

openclaw config set tools.elevated.enabled false

Enable the sandbox tool allowlist (start tight):

openclaw config set tools.sandbox.tools.allow '["exec"]'

Set sandbox defaults (session-scoped, no workspace access):

openclaw config set agents.defaults.sandbox.mode "non-main"
openclaw config set agents.defaults.sandbox.scope "session"
openclaw config set agents.defaults.sandbox.workspaceAccess "none"

Sanity-check:

openclaw sandbox explain
openclaw security audit


⸻

4) Ensure the sandbox Docker image exists

Check:

docker images | grep -E 'openclaw-sandbox|openclaw' || true

You want to see:
openclaw-sandbox:bookworm-slim

If it’s missing, build it from the repo script:

cd ~
git clone https://github.com/openclaw/openclaw.git
cd openclaw
./scripts/sandbox-setup.sh

Re-check images:

docker images | grep -E 'openclaw-sandbox|openclaw'


⸻

5) Store OpenAI API key safely (Keychain) and inject at runtime

Store key in Keychain without putting it in shell history

read -s "OPENAI_API_KEY?Paste OpenAI API key: "
echo
security add-generic-password -a "$USER" -s openai_api_key -w "$OPENAI_API_KEY" -U
unset OPENAI_API_KEY

Start the gateway with the key injected (localhost only)

OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s openai_api_key -w)" \
openclaw gateway --bind loopback --port 18789 --verbose

Open the dashboard:

openclaw dashboard


⸻

6) Pick the default model (example: GPT-5.2)

Confirm models:

OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s openai_api_key -w)" \
openclaw models list

Set default model:

openclaw config set agents.defaults.model.primary "openai/gpt-5.2"

Restart gateway:

openclaw gateway stop
OPENAI_API_KEY="$(security find-generic-password -a "$USER" -s openai_api_key -w)" \
openclaw gateway --bind loopback --port 18789 --verbose


⸻

7) Prove tool execution is sandboxed (Docker container appears)

Run a gateway agent turn with an explicit session id:

openclaw agent --session-id sandbox-test --message \
"Use the exec tool to run: sleep 15; then run: echo sandbox_ok; reply with outputs."

Check Docker:

docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Names}}\t{{.Status}}"
docker ps -a --filter ancestor=openclaw-sandbox:bookworm-slim --format "table {{.ID}}\t{{.Status}}\t{{.Names}}"

You should see a container like:
openclaw-sbx-sandbox-test-... using openclaw-sandbox:bookworm-slim

⸻

Recommended safety defaults
	•	Run gateway on localhost only: --bind loopback
	•	tools.elevated.enabled = false
	•	agents.defaults.sandbox.workspaceAccess = "none"
	•	Keep tools.sandbox.tools.allow tight (start with ["exec"])
	•	Keep API keys out of openclaw.json (use Keychain + env injection)

⸻
