# syntax=docker/dockerfile:1
# Production image for apps/worker. Build context is the repo root -- see apps/api/Dockerfile
# for the reasoning. No port and no healthcheck: the worker pulls work rather than serving it.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @vereinsfunk/worker...
RUN pnpm --filter @vereinsfunk/worker build
# --legacy and node-linker=hoisted: see apps/api/Dockerfile.
RUN pnpm --filter @vereinsfunk/worker deploy --legacy --prod --config.node-linker=hoisted /out

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
# The worker validates its Supabase and Hatchet credentials before opening any connection.
CMD ["node", "dist/index.js"]
