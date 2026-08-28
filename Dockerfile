FROM node:24-bookworm

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV PNPM_STORE_DIR="/pnpm/store"

WORKDIR /workspace

RUN corepack enable && corepack prepare pnpm@11.11.0 --activate
# Die Bildstil-Galerie wird auch lokal mit denselben kuratierten G'MIC-Rezepten wie in der
# Produktion gerendert. Ohne das zeigte die Entwicklung nur Sharp bzw. markierte die Effekte als
# nicht verfügbar, obwohl der Produktionscontainer sie ausführen kann.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gmic \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p "${PNPM_HOME}" "${PNPM_STORE_DIR}" \
 && chown -R node:node /workspace "${PNPM_HOME}" "${PNPM_STORE_DIR}"
USER node

CMD ["pnpm", "dev"]
