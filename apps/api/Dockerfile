# syntax=docker/dockerfile:1
# Production image for apps/api. The build context is the repo root, not apps/api -- the build
# needs the lockfile and every packages/* the API imports. The Dockerfile at the repo root is
# the dev container used by docker-compose.yml; this one is what CI pushes to GHCR.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY packages ./packages
COPY apps ./apps
# The trailing dots select the API plus the workspace packages it depends on, so apps/remotion's
# Chromium-sized dependency tree never enters this build.
RUN pnpm install --frozen-lockfile --filter @vereinsfunk/api...
RUN pnpm --filter @vereinsfunk/api build
# Self-contained tree with production-only node_modules, resolved from the same lockfile.
# --legacy because pnpm 10+ otherwise demands inject-workspace-packages=true, which would change
# how every dev install links workspace packages -- a repo-wide change for a build-only need.
# The workspace deps it copies along are dead weight here: tsup already bundled them into dist.
# node-linker=hoisted gives /out a flat node_modules. The bundle imports the third-party deps of
# the bundled workspace packages (jsdom and dompurify, via @vereinsfunk/svg-safe) as top-level
# specifiers; under pnpm's default isolated layout those sit inside svg-safe's own subtree and
# would not resolve from /app/dist/server.js.
RUN pnpm --filter @vereinsfunk/api deploy --legacy --prod --config.node-linker=hoisted /out

FROM base AS runtime
ENV NODE_ENV=production
# G'MIC bleibt ausschliesslich im Servercontainer; Browser erhalten nur das fertige Derivat.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gmic \
 && rm -rf /var/lib/apt/lists/*
ENV IMAGE_EFFECTS_PROVIDER=gmic
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# Plan 036: der Migrations-Boot-Hook (packages/db-migrate, aufgerufen aus server.ts vor jeder
# Route-Registrierung) braucht die Migrationsdateien selbst zur Laufzeit, nicht nur zur Build-Zeit
# -- `pnpm deploy` oben kopiert nur Node-Pakete, keine losen Repo-Ordner wie supabase/migrations.
COPY --chown=node:node supabase/migrations ./supabase/migrations
USER node
EXPOSE 4201
# Same probe as the api service in docker-compose.yml. bookworm-slim ships neither curl nor wget,
# so this uses node itself rather than pulling in another package. The port is read from the
# environment rather than hardcoded -- API_PORT is configurable, and a fixed 4201 here left the
# container stuck reporting "starting" forever whenever it was set to anything else.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4201)+'/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Configuration arrives as environment variables from the Quadlet unit (see the vereinsfunk
# Ansible role) -- never from a .env file baked into the image.
CMD ["node", "dist/server.js"]
