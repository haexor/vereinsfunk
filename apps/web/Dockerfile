# syntax=docker/dockerfile:1
# Production image for apps/web. Build context is the repo root -- see apps/api/Dockerfile for
# the reasoning. Nitro's .output is fully self-contained, so the runtime stage needs neither
# pnpm nor node_modules.

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
WORKDIR /workspace

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json turbo.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @vereinsfunk/web...
# nuxt.config.ts reads NUXT_PUBLIC_* at build time and bakes the values into runtimeConfig, but
# they are deliberately left unset here: Nitro re-reads NUXT_PUBLIC_* from the environment on
# every start, and the process environment wins over any baked or file-based value. That keeps
# one image usable across environments instead of burying a hostname in a layer.
RUN pnpm --filter @vereinsfunk/web build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=4200
WORKDIR /app
COPY --from=build --chown=node:node /workspace/apps/web/.output ./.output
USER node
EXPOSE 4200
# Port read from the environment, not hardcoded -- NITRO_PORT is configurable. The unauthenticated
# root redirects to /anmelden, so a 302 counts as healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NITRO_PORT||4200)+'/',{redirect:'manual'}).then(r => process.exit(r.status < 400 ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
