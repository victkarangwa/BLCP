# ─────────────────────────────────────────────────────────────────────────────
#  Web Dockerfile — multi-stage build for Next.js.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./

USER app

ENV NODE_ENV=production
EXPOSE 3001

CMD ["npm", "run", "start"]
