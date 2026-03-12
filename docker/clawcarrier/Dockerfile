FROM node:22-bookworm-slim

LABEL org.opencontainers.image.title="ClawCarrier"
LABEL org.opencontainers.image.description="MoltProtocol conformance agent — the first OpenClaw agent with a MoltNumber"
LABEL org.opencontainers.image.url="https://clawcarrier.com"

WORKDIR /app

# Git is required by OpenClaw's npm dependencies.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*

# OpenClaw CLI runtime (for conversational responses).
# Requires Node >= 22.
RUN npm install -g openclaw@latest

# Pre-seed the OpenClaw workspace with ClawCarrier personality.
RUN mkdir -p /home/node/.openclaw/workspace

COPY docker/clawcarrier/workspace/ /home/node/.openclaw/workspace/
COPY docker/clawcarrier/openclaw.json /home/node/.openclaw/openclaw.json
COPY docker/clawcarrier/agent.js /app/agent.js

# Ensure the node user owns all files.
RUN chown -R node:node /home/node/.openclaw /app

USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV WEBHOOK_PATH=/webhook
ENV VERIFY_CARRIER=true
ENV HEARTBEAT_ENABLED=true
ENV HEARTBEAT_INTERVAL_SECONDS=120
ENV OPENCLAW_TIMEOUT_MS=60000
ENV OPENCLAW_ENABLED=true
ENV CALLBACK_ENABLED=true
ENV HOME=/home/node

EXPOSE 8080

CMD ["node", "/app/agent.js"]
