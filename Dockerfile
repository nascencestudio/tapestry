# syntax=docker/dockerfile:1.7
#
# Production image for the playground site (Astro + StudioCMS + Tapestry +
# the media library). See docs/guides/deployment.md.
#
#   docker build --platform linux/amd64 -t nascence-site .   # Hetzner CPX (x86-64)
#
# Data (SQLite database and uploaded media) lives in the /data volume.

ARG NODE_VERSION=22.23.3

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CI=true
# pnpm comes from Corepack, pinned (with its hash) by "packageManager" in package.json.
RUN corepack enable
WORKDIR /repo

# Dependencies first, for layer caching. The lockfile is frozen and every
# supply-chain policy in pnpm-workspace.yaml applies here too.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tapestry/package.json packages/tapestry/
COPY playground/package.json playground/
COPY website/package.json website/
# Dependency patches (pnpm-workspace.yaml patchedDependencies) must exist before the install.
COPY patches/ patches/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
# The public URL (e.g. https://example.com): Astro bakes it into the build.
ARG SITE_URL=http://localhost:4321
RUN SITE_URL="$SITE_URL" pnpm --filter @nascencestudio/tapestry --filter playground build

# A self-contained copy of the site with production dependencies only.
RUN pnpm --filter playground deploy --prod --legacy /app \
 && cp -R playground/dist /app/dist

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321 \
    CMS_LIBSQL_URL=file:/data/studiocms.db \
    MEDIA_DIR=/data/media
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN mkdir -p /data/media && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4321
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4321) + '/').then((r) => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "dist/server/entry.mjs"]
