#!/bin/sh
# Container entrypoint: check required settings, apply database migrations
# (safe to repeat), then start the server (or run the given command).
set -eu

if [ -z "${CMS_ENCRYPTION_KEY:-}" ]; then
	echo "CMS_ENCRYPTION_KEY is not set. Generate one with: openssl rand --base64 16" >&2
	exit 1
fi

mkdir -p "${MEDIA_DIR:-/data/media}"

if [ "${SKIP_MIGRATIONS:-}" != "1" ]; then
	node node_modules/studiocms/studiocms-cli.mjs migrate --latest
fi

exec "$@"
