# 0020. Continuous integration with GitHub Actions

- Status: Accepted
- Date: 2026-10-06

## Context

Everything was verified by hand each session (lint, types, unit tests, audit,
builds, 12 browser e2e suites, the Docker image). The roadmap asked for CI that
builds the image and runs the tests. Where the repository will be hosted hasn't been
decided (it isn't in version control yet); GitHub is assumed as the most common
choice, and only this workflow file is GitHub-specific. The supply-chain rules
(ADR 0003) apply to CI too.

## Decision

`.github/workflows/ci.yml`, on pushes to `main` and on pull requests, three jobs:

1. **check**: `pnpm install --frozen-lockfile`, lint, audit, build, typecheck, unit tests.
2. **e2e**: a fresh StudioCMS site per run. Throwaway `CMS_ENCRYPTION_KEY`
   (masked), `pnpm migrate`, first-time setup without a browser
   (`CMS_SETUP=1` turns StudioCMS's setup routes on; `scripts/setup-site.mjs` posts
   the wizard's two steps and writes `.dev-credentials`), dev server, seed, then
   `pnpm e2e` in the runner's preinstalled Chrome. The dev log is printed on failure.
3. **docker**: builds the production image, starts it hardened (read-only, no
   capabilities, no-new-privileges), waits for the healthcheck, checks it runs as
   non-root, and checks that sharp's native binary resolves from the server bundle
   (`.github/scripts/check-sharp.mjs`, known issue #30).

Hardening: `permissions: contents: read`; actions pinned to full commit SHAs
(`actions/checkout` v7.0.1, `actions/setup-node` v7.0.0) with the tag in a comment;
`persist-credentials: false`; pnpm through Corepack at the `packageManager`
version; only two third-party actions (Docker via the runner's CLI, no
Docker actions). The workflow passes `actionlint` (with shellcheck).

`dbStartPage` in the playground's StudioCMS config is now `process.env.CMS_SETUP === '1'`
instead of `false`, so a fresh database can be set up by script (locally too).

## Alternatives considered

- **e2e against the production build** instead of the dev server: closer to real
  use, but the suites are written and debugged against `astro dev`; the docker job
  covers the production build's startup.
- **Third-party Docker actions** (buildx, build-push): not needed for a build-only
  check; fewer actions, less supply chain.
- **A committed test database** for e2e: would carry a password hash and drift from
  migrations; a fresh setup per run tests the real path.

## Consequences

- The e2e job takes several minutes (Chrome, 12 suites). Cancelled automatically
  when a newer commit arrives on the same ref.
- Dependabot (or Renovate) for the pinned action SHAs is a later step.
- Running the e2e suites against a fresh site surfaced two test assumptions (fixed):
  resetting an already-published demo page sends no save, and an inline-editing step
  needed to wait for the toolbar to settle.
