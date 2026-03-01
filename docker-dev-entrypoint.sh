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
# Pipe through cat to prevent next dev from detecting a TTY and forking
exec ./node_modules/.bin/next dev --hostname 0.0.0.0 --port 3000 2>&1
