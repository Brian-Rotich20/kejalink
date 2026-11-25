# syntax=docker/dockerfile:1

# ── Build ────────────────────────────────────────────────────────────────────
# glibc base: TypeScript 7's native compiler package is not installed on Alpine (musl).
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    TZ=UTC \
    PORT=5000
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
# SQL migrations, applied by `node dist/scripts/migrate.js` as a release step.
COPY src/db/migrations ./src/db/migrations

USER node
EXPOSE 5000
CMD ["node", "dist/server.js"]
