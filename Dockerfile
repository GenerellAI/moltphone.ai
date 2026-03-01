FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package*.json ./
RUN npm ci

FROM deps AS builder
COPY . .
RUN npx prisma generate
ENV NEXTAUTH_SECRET=build-placeholder
RUN npm run build
# Compile seed script and its lib dependencies to JS for the production image
RUN npx tsc prisma/seed.ts lib/phone-number.ts lib/secrets.ts lib/hmac.ts \
    --outDir /app/dist-seed \
    --esModuleInterop \
    --module commonjs \
    --moduleResolution node \
    --skipLibCheck \
    --declaration false

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl

COPY --from=builder /app/package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/next.config.mjs ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/dist-seed ./dist-seed
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 3000
CMD ["npm", "start"]
