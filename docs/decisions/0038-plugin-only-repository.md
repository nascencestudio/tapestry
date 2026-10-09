# 0038. The Tapestry repository holds only the plugin

- Status: Accepted (the user's decision, 2026-10-09)
- Date: 2026-10-09

## Context

After the media library moved out (ADR 0037), the first push of `nascencestudio/tapestry`
contained the whole monorepo: the plugin in `packages/tapestry`, the playground site, its
Docker deployment, four dependency patches, the devlog and research notes. The user wants the
plugin's repository to be the plugin, like the media library's.

## Decision

1. **`nascencestudio/tapestry`** is the package at the root: `src/`, `test/`, `scripts/`,
   `patches/studiocms@0.6.1.patch` (shipped to users, not applied here), README (npm and GitHub
   front page), LICENSE. It keeps the user documentation (guides, data model, architecture,
   security, known issues, roadmap), **all ADRs**, and the Starlight docs site (`website/`, the
   only other workspace project). CI: lint, audit, build, typecheck, unit tests, package
   contents, docs build. Releases: staged with provenance (ADR 0035).
2. **`nascencestudio/tapestry-playground`** (new) is the dev site at its root: browser e2e
   suites, performance budget, Docker + Caddy deployment, the dependency patches (StudioCMS,
   Astro, @studiocms/md, @withstudiocms/sdk: they fix the *site*), and the working notes: the
   devlog, research notes and upstream drafts. It installs Tapestry and the media library from
   npm; to test unreleased plugin changes it points at a sibling checkout (`file:../tapestry`).
3. **History:** the pushed monorepo commit is replaced by a plugin-only commit (force push by
   the user; nothing depended on it: no release, no tags). The monorepo state is kept on a local
   `monorepo-archive` branch.
4. Rules stay as they were: a session's devlog entry goes to the playground's devlog, and editor
   UI changes must keep the playground's e2e suites passing.

## Alternatives considered

- **Keep the monorepo:** simplest for development, but the user wants a plugin-only repository.
- **Playground only on this machine:** no CI for the browser tests or the Docker image, no backup.
- **All docs with the playground:** users of the plugin need the guides and reference next to
  the code and on the docs site; the ADRs explain the plugin's design.

## Consequences

- Browser tests no longer run on plugin pull requests; they run in the playground's CI against
  released versions. Run them locally (`file:../tapestry`) before releasing UI changes.
- The playground's CI and Docker build can't install until Tapestry 0.1.0 is on npm.
- Docs links to moved files point to the playground repository on GitHub.
