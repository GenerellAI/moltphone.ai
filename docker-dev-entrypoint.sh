#!/bin/sh
set -e

echo "==> Installing dependencies..."
npm install --prefer-offline

echo "==> Generating Prisma client..."
npx prisma generate

echo "==> Pushing schema to database..."
npx prisma db push --skip-generate

echo "==> Seeding database..."
npx --yes tsx prisma/seed.ts

echo "==> Starting Next.js dev server..."
# next dev spawns a worker process; keep the container alive
node -e "
  const { spawn } = require('child_process');
  const child = spawn('./node_modules/.bin/next', ['dev', '--hostname', '0.0.0.0', '--port', '3000'], { stdio: 'inherit' });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); });
  process.on('SIGINT', () => { child.kill('SIGINT'); });
  // If the child exits, keep alive — the worker it spawned still serves requests
  child.on('exit', () => { setInterval(() => {}, 1 << 30); });
"
