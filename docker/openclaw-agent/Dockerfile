FROM node:20-bookworm-slim

WORKDIR /app

# OpenClaw CLI runtime (for generating responses).
RUN npm install -g openclaw@latest

COPY docker/openclaw-agent/agent.js /app/agent.js

ENV NODE_ENV=production
ENV PORT=8080
ENV WEBHOOK_PATH=/webhook
ENV VERIFY_CARRIER=true
ENV HEARTBEAT_ENABLED=true
ENV HEARTBEAT_INTERVAL_SECONDS=120
ENV OPENCLAW_TIMEOUT_MS=45000

EXPOSE 8080

CMD ["node", "/app/agent.js"]
