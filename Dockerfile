# syntax=docker/dockerfile:1

# Two images from one file (docs/docker.md):
#   docker build --target vikaki -t vikaki .          page, hub and speech (the fake test voice), small
#   docker build --target vikaki-render -t vikaki-render .   adds Chromium, for `stream` and `serve --headless`

ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV CI=1 PNPM_HOME=/pnpm
RUN corepack enable
WORKDIR /app

# ---- build the avatar page (needs Three.js, Vite and the rest: none of it ships) ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @vikaki/engine build

# ---- the small image: only the command line and what it runs ----
FROM base AS vikaki
# Every package's manifest is needed for a frozen install, but only the command line's dependencies are installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/audio/package.json packages/audio/
COPY packages/cli/package.json packages/cli/
COPY packages/e2e/package.json packages/e2e/
COPY packages/engine/package.json packages/engine/
COPY packages/extension/package.json packages/extension/
COPY packages/protocol/package.json packages/protocol/
COPY packages/render/package.json packages/render/
COPY packages/server/package.json packages/server/
COPY packages/tts/package.json packages/tts/
# The package store is only a cache for the install; it is deleted in the same layer so it does not add to the image.
RUN pnpm install --frozen-lockfile --prod --filter "@vikaki/cli..." --config.confirmModulesPurge=false --store-dir /tmp/pnpm-store \
 && rm -rf /tmp/pnpm-store
COPY packages/audio packages/audio
COPY packages/cli packages/cli
COPY packages/protocol packages/protocol
COPY packages/render packages/render
COPY packages/server packages/server
COPY packages/tts packages/tts
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY personas.example.yaml ./
COPY packages/engine/public/avatars packages/engine/public/avatars
# One folder for what the person brings (a personas file, recordings), owned by the user the server runs as.
RUN mkdir /data && chown node:node /data
WORKDIR /app/packages/cli
ENV VIKAKI_IMAGE=vikaki
USER node
EXPOSE 8787
# Healthy when the avatar page answers. `node` has fetch, so there is no curl to install.
HEALTHCHECK --interval=2s --timeout=3s --start-period=2s --retries=20 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8787/avatar/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
ENTRYPOINT ["node", "--import", "tsx", "src/index.ts"]
# Listens on every interface inside the container; publish it to the host's loopback only: -p 127.0.0.1:8787:8787
CMD ["serve", "--host", "0.0.0.0", "--port", "8787"]

# ---- the same, with a browser for headless rendering ----
FROM vikaki AS vikaki-render
USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright VIKAKI_IMAGE=vikaki-render
RUN cd /app/packages/render && pnpm exec playwright-core install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /opt/ms-playwright/chromium_headless_shell-* /opt/ms-playwright/ffmpeg-*
USER node
