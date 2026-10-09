# 0017. Docker deployment on a single Hetzner Cloud server

- Status: Accepted
- Date: 2026-10-06

## Context

The site will run on a Hetzner Cloud CPX server (x86-64, 2–3 vCPU, 2–4 GB RAM).
It needs Node, persistent storage for the SQLite database and uploaded media,
and HTTPS.

## Decision

- **Multi-stage Dockerfile** on `node:22.23.3-bookworm-slim` (current Node 22 LTS,
  with the 2026 security releases). pnpm comes from Corepack, pinned by
  `packageManager`; `pnpm install --frozen-lockfile` with all supply-chain policies;
  `pnpm deploy --prod --legacy` produces a self-contained runtime directory.
- **Runtime hardening**: runs as `node` (uid 1000), read-only root filesystem
  (`/tmp` as tmpfs), all capabilities dropped, `no-new-privileges`, health check.
- **Data** in one volume, `/data`: `studiocms.db` and `media/`.
- **Entrypoint** refuses to start without `CMS_ENCRYPTION_KEY`, applies StudioCMS
  migrations (`migrate --latest`, safe to repeat), then starts the server.
- **Caddy** (2.11.4) in front: automatic Let's Encrypt certificates, HSTS and other
  security headers, compression, 210 MB request limit (uploads). The app isn't
  published to the host.
- **Proxy trust**: Astro's `security.allowedDomains` lists the site's domain (from
  `SITE_URL`, a build argument), so `Astro.url` uses the proxy's
  `X-Forwarded-Host/Proto` for that host only and same-origin checks see `https://`.
- First admin: `docker compose exec -it app node node_modules/studiocms/studiocms-cli.mjs users`.

## Alternatives considered

- **Nginx + certbot**: more moving parts than Caddy for the same result.
- **Turso/libSQL server**: not needed for one server; SQLite on a volume is simpler.
- **Bare metal with systemd**: Docker makes the build reproducible and the
  hardening (read-only FS, dropped capabilities) easy.

## Consequences

- Images must be built for `linux/amd64` (CPX is x86-64): on the server, or with
  `docker buildx build --platform linux/amd64` on an Apple Silicon Mac.
- The image is ~630 MB (StudioCMS's dependency tree); trimming is possible later.
- Backups: copy the `/data` volume (the guide shows a SQLite-safe way).
- Verified locally: fresh volume → migrations → healthy server, non-root, read-only FS.
