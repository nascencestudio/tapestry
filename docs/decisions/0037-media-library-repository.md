# 0037. The media library moves to its own repository

- Status: Accepted (the user chose "Move it out", 2026-10-08)
- Date: 2026-10-08

## Context

`@nascencestudio/medialibrary` was developed in this monorepo (`packages/medialibrary`,
ADR 0016). For the first release the user created two GitHub repositories,
`nascencestudio/tapestry` and `nascencestudio/medialibrary`. npm provenance links a package
to the repository and workflow that built it, so a package released from the Tapestry repo
would point at the wrong place. Options: keep the code here and mirror it, or move it.

## Decision

1. **The medialibrary repository is the only home of its code**: sources, unit tests and
   fixtures, build scripts, the supply-chain hardening (`pnpm-workspace.yaml`, its own
   reasons), CI and release workflows (provenance, trusted publishing), its own `CLAUDE.md`,
   devlog, and copies of its ADRs (0003, 0016, 0018, 0019). `packages/medialibrary` is
   removed here.
2. **Tapestry uses it from npm.** It stays an *optional peer* of `@nascencestudio/tapestry`
   (`^0.1.0`); Tapestry finds it at build time through its virtual modules, as before. The
   playground depends on it directly.
3. **Transition:** until 0.1.0 is published, the playground and Tapestry's devDependency use
   `file:../medialibrary` (a checkout next to this repo). `file:` installs a copy and dedupes
   its dependencies (`link:` doesn't, which duplicated Preact). CI and Docker can't install
   in this state; switching both to `0.1.0` is the release step that fixes it.
   `minimumReleaseAgeExclude` lists the package so our own release can be installed at once.
4. **Browser tests stay here.** The media e2e suites need the whole site; their fixtures are
   copied to `playground/e2e/fixtures`. The medialibrary repo runs unit tests, typecheck,
   lint and audit; its CLAUDE.md says to run Tapestry's e2e before UI releases.
5. Tapestry's CI, release workflow and Dockerfile build only Tapestry and the playground.

Update 2026-10-09: 0.1.0 is on npm (with provenance); the `file:` dependencies are replaced by
`0.1.0`, so CI and Docker install again.

## Alternatives considered

- **Keep it in the monorepo and publish from here:** provenance would name the Tapestry repo,
  and the empty medialibrary repo would confuse users.
- **Mirror it (subtree split):** two sources of truth and a sync step that can drift.
- **A pnpm workspace across both checkouts:** works only on machines with both repos side by
  side; CI and other contributors would need a matching layout.

## Consequences

- Release order matters: media library first, then switch the dependency here, then Tapestry.
- A media library change used by Tapestry needs a medialibrary release (or a temporary
  `file:` dependency while developing).
- The devlog here keeps the history up to session 22; later media library work is logged in
  its own repo.
