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
# Paket 048: eigener, world-readable Browser-Pfad statt des Root-Home-Verzeichnisses (Default),
# weil der Download unten als root laeuft (installiert Systembibliotheken per apt), der Prozess
# selbst aber als node faehrt.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Plan 036: same reasoning as apps/api/Dockerfile -- the migration boot hook (packages/db-migrate,
# called at the top of index.ts's main()) needs the migration files themselves at runtime.
COPY --chown=node:node supabase/migrations ./supabase/migrations
# Chromium fuer die Website-Screenshot-Analyse (Paket 048, KI-Markenerkennung). Muss vor dem
# USER-Wechsel laufen: --with-deps installiert die noetigen Systembibliotheken per apt-get und
# braucht dafuer root.
RUN npx playwright install --with-deps chromium && chmod -R a+rX "$PLAYWRIGHT_BROWSERS_PATH"
USER node
# The worker validates its Supabase and Hatchet credentials before opening any connection.
CMD ["node", "dist/index.js"]
