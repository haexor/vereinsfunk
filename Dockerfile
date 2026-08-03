FROM node:24-bookworm

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV PNPM_STORE_DIR="/pnpm/store"

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate

RUN mkdir -p "${PNPM_HOME}" "${PNPM_STORE_DIR}" \
 && chown -R node:node /workspace "${PNPM_HOME}" "${PNPM_STORE_DIR}"
USER node

CMD ["pnpm", "dev"]
