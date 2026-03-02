FROM node:22-bookworm-slim

WORKDIR /app

# OpenClaw CLI runtime (for generating responses).
# Requires Node >= 22.
RUN npm install -g openclaw@latest

# Pre-seed the OpenClaw workspace so the agent has a personality.
# These files are injected into the agent context on the first turn.
RUN mkdir -p /home/node/.openclaw/workspace

COPY docker/openclaw-agent/workspace/ /home/node/.openclaw/workspace/
COPY docker/openclaw-agent/openclaw.json /home/node/.openclaw/openclaw.json
COPY docker/openclaw-agent/agent.js /app/agent.js

# Ensure the node user owns all OpenClaw files.
RUN chown -R node:node /home/node/.openclaw /app

USER node

ENV NODE_ENV=production
ENV PORT=8080
ENV WEBHOOK_PATH=/webhook
ENV VERIFY_CARRIER=true
ENV HEARTBEAT_ENABLED=true
ENV HEARTBEAT_INTERVAL_SECONDS=120
ENV OPENCLAW_TIMEOUT_MS=60000
ENV HOME=/home/node

EXPOSE 8080

CMD ["node", "/app/agent.js"]
