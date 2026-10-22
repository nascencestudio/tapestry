# 0044. One Preact runtime: ranges for preact and @preact/signals

- Status: Accepted (2026-10-22)
- Date: 2026-10-22

## Context

Tapestry's editor and the media library's picker (and tapestry-seo's and tapestry-menus' editor UI) run in the
same dashboard page on one Preact runtime: the picker renders inside the editor, and signals cross between them.
Every package pinned `preact` and `@preact/signals` exactly (our `saveExact` rule). During the upgrade to Astro
7.4 (playground session 47), `@astrojs/preact` 6.1.0 started asking for `@preact/signals ^2.11.3` while our
packages pinned 2.11.2: the site got two copies of `@preact/signals`, both hooking the same Preact, and opening
the media picker failed ("Cycle detected"). The same happens whenever two of our packages are released with
different pins, or a site's own packages want a newer patch.

## Decision

Published packages that share the editor's runtime declare `preact` and `@preact/signals` as caret ranges
(`^10.29.8`, `^2.11.2`) instead of exact versions, so the site's package manager settles on one copy. Everything
else stays pinned exactly; each repository's lockfile still pins what its own tests run. An exception to the
`saveExact` rule, for these two runtime singletons only.

## Consequences

- Sites get one Preact and one `@preact/signals`, whichever versions satisfy every package.
- A site may run a newer patch or minor than our tests did (within the major). Releases keep testing the newest.
- The playground forces one `@preact/signals` with an override until the media library release carrying the
  range is on npm (reason and exit condition in its `pnpm-workspace.yaml`).
