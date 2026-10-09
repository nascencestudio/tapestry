# 0035. Releasing to npm with provenance

- Status: Accepted (user decisions 2026-10-08: MIT © Nascence Studio; publish with
  provenance from GitHub Actions; document the StudioCMS patch and report it upstream)
- Date: 2026-10-08

## Context

Phase 5's "publish `@nascencestudio/tapestry` to npm with provenance". The project's
supply-chain rules (pnpm only, provenance where possible, release-age gates) should hold
for what we publish too: users should be able to verify that a package was built from
this repository by its CI.

## Decision

1. **Packages:** `@nascencestudio/medialibrary` and `@nascencestudio/tapestry`, both
   **0.1.0** for the first public release (pre-1.0: minor versions may break). They ship
   `dist/` (built JS, types, `.astro` files), `README.md`, `LICENSE` (MIT © Nascence
   Studio), and for Tapestry `patches/studiocms@0.6.1.patch`. Metadata: `author`,
   `engines` (Node ≥ 22.12), `keywords`, `publishConfig` (`access: public`,
   `provenance: true`). `repository`, `homepage` and `bugs` are added once the GitHub URL
   is known.
2. **Publishing only from CI:** `.github/workflows/release.yml` runs when a GitHub release
   is published: checks the tag matches both versions, runs lint, audit, build and unit
   tests, then `pnpm -r publish --provenance` (media library first). `id-token: write` for
   provenance and npm **trusted publishing** (OIDC, no stored token); an `NPM_TOKEN`
   secret is the fallback until trusted publishing is configured on npmjs.com. The job
   uses a protected `npm` environment (can require approval).
3. **The StudioCMS patch (#37):** islands and component scripts need it. Tapestry ships the
   two-file patch (verified to apply to a pristine studiocms 0.6.1) and its README explains
   applying it with pnpm (or patch-package). The issue is drafted for StudioCMS
   (`docs/upstream/studiocms-component-scripts.md`).

## Alternatives considered

- **Publishing from a developer machine:** no provenance, and a stolen token publishes
  anything. Rejected (the user preferred provenance).
- **Bundling the editor's dependencies** (ProseMirror, Preact, Pragmatic DnD) into the
  package: hides them from `pnpm audit` and dedupe; kept as normal dependencies, pinned.
- **Applying the StudioCMS fix at runtime** (monkey-patching from the plugin): fragile and
  surprising; a visible patch file is honest and easy to drop later.

## Consequences

- A release is: bump the version, merge, publish a GitHub release `v<version>`.
- Until the repository is on GitHub, nothing can be published (by design).
- Update (2026-10-08): the media library is released from its own repository
  ([ADR 0037](0037-media-library-repository.md)); this repo's workflow publishes Tapestry only.
- Update (2026-10-09): releases are **staged** (`pnpm stage publish --provenance`). The trusted
  publisher's allowed actions are stage only ("allow npm publish" stays off, as npm recommends),
  so the workflow can submit a version but a maintainer approves it with 2FA before it's live.
  A compromised workflow or repository can't ship a release on its own. The first release of a
  package still needs a token (trusted publishers attach to existing packages).
