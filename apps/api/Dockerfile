# ─────────────────────────────────────────────────────────────────────────────
#  API Dockerfile — multi-stage build.
#
#  Stage 1 (builder) installs all deps and compiles TypeScript.
#  Stage 2 (runtime) keeps only production deps and the compiled output.
#
#  Note on Prisma: we run `prisma generate` in builder so the client lives
#  alongside the compiled output. `migrate deploy` is run by the entrypoint
#  on container start (using DATABASE_ADMIN_URL).
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app

# Argon2 needs build tools at install time.
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache python3 make g++ \
    && addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/storage && chown -R app:app /app
USER app

ENV NODE_ENV=production
EXPOSE 3000

# `migrate deploy` is idempotent: applies pending migrations only.
# Then start the compiled server.
CMD ["sh", "-c", "DATABASE_URL=$DATABASE_ADMIN_URL npx prisma migrate deploy && node dist/main"]
