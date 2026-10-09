# Deploying to a Hetzner Cloud server (Docker)

This runs the site (Astro + StudioCMS + Tapestry + the media library) on one
server with Docker Compose: the app container, and Caddy in front for HTTPS.
Decision record: [ADR 0017](../decisions/0017-docker-deployment.md).

## 1. Server

- A Hetzner Cloud **CPX11** (2 vCPU, 2 GB) is enough to start; **CPX21** gives room
  for larger video uploads. Ubuntu 24.04, your SSH key, and a firewall allowing
  only 22, 80 and 443 (Hetzner's Cloud Firewall or `ufw`).
- Install Docker Engine with the Compose plugin (docs.docker.com → Install → Ubuntu).
- Point your domain's DNS **A** (and **AAAA**) records at the server's IP.

## 2. Configure

On the server:

```sh
git clone <your repository> site && cd site
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`:

| Variable | Value |
| --- | --- |
| `SITE_DOMAIN` | Your domain, e.g. `example.com` (Caddy gets the certificate; Astro trusts the proxy for it) |
| `CMS_ENCRYPTION_KEY` | `openssl rand --base64 16` (keep it safe; changing it invalidates encrypted settings) |

The database (`/data/studiocms.db`) and uploads (`/data/media`) live in the
`site-data` volume; you don't set paths.

## 3. Build and start

```sh
docker compose --env-file .env.production up -d --build
docker compose logs -f app      # migrations, then "Server listening"
```

`--env-file` lets Compose fill in `SITE_DOMAIN` for the build. The image is built
on the server, so it matches its architecture (x86-64 on CPX).

> Building on an Apple Silicon Mac instead? `docker buildx build --platform linux/amd64 -t nascence-site .`,
> then push it to a registry and set `image:` in `compose.yaml`.

## 4. First admin

```sh
docker compose exec -it app node node_modules/studiocms/studiocms-cli.mjs users
```

Choose "Create new user", role **Owner**. Then sign in at `https://your-domain/dashboard`.

## 5. Updates

```sh
git pull
docker compose --env-file .env.production up -d --build
```

Migrations run on every start (they're safe to repeat).

## 6. Backups

Everything is in the `site-data` volume. A consistent copy (SQLite's own backup,
then the media files):

```sh
docker compose exec app node -e "const {createClient}=require('@libsql/client');createClient({url:'file:/data/studiocms.db'}).execute(\"VACUUM INTO '/data/backup.db'\").then(()=>console.log('ok'))"
docker run --rm -v site_site-data:/data -v "$PWD":/backup alpine tar czf /backup/site-data-$(date +%F).tgz -C /data backup.db media
```

(The volume name is `<folder>_site-data`; check with `docker volume ls`.) Store
backups off the server, e.g. Hetzner Storage Box. Hetzner's server snapshots are
a useful extra, not a replacement.

## What's hardened

- The app runs as an unprivileged user on a read-only filesystem, with all Linux
  capabilities dropped; only `/data` (volume) and `/tmp` are writable.
- The app isn't reachable directly; Caddy terminates HTTPS (automatic certificates,
  HSTS, `nosniff`, referrer and permissions policies) and limits request bodies to `MEDIA_MAX_UPLOAD_MB` (default 1024 MB), the same
  ceiling the app puts on the upload limits admins can set.
- Uploaded files are served with `nosniff` and a sandboxing Content-Security-Policy
  (see [security.md](../security.md#media-library)).
- `.env.production` is never committed (`.gitignore`) and never copied into the image (`.dockerignore`).

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Editor/canvas actions fail with 403 "Cross-origin request refused" | `SITE_DOMAIN` must be the domain you browse; rebuild after changing it (Astro bakes it in). |
| Caddy can't get a certificate | DNS must point at the server and ports 80/443 must be open. |
| Container exits: "CMS_ENCRYPTION_KEY is not set" | Fill it in `.env.production`. |
| A large upload fails | Check the limit in Plugins → Media Library → Uploads. To allow more than the ceiling, set `MEDIA_MAX_UPLOAD_MB` in `.env.production` and run `docker compose --env-file .env.production up -d` (both the app and Caddy read it). |
