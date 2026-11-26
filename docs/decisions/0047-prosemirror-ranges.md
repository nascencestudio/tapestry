# 0047. One ProseMirror: ranges for the prosemirror-* packages

- Status: Accepted (2026-11-25)
- Date: 2026-11-25

## Context

The rich text editor (ADR 0012) uses eight `prosemirror-*` packages, all pinned exactly (our `saveExact` rule).
They depend on each other through caret ranges (`prosemirror-state` asks for `prosemirror-model ^1.0.0`, and so
on), and ProseMirror refuses to work with two copies of a core package: a node from one `prosemirror-model` isn't
an instance of the other's classes ("Can not convert <…> to a Fragment (looks like multiple versions of
prosemirror-model were loaded)").

Tapestry 0.7.2 pinned newer `prosemirror-model`, `-transform` and `-view` (1.25.13, 1.12.7, 1.43.0). The
playground's lockfile still resolved the older versions (1.25.12, 1.12.2, 1.42.6) for the packages that reach them
through ranges, so the site loaded two copies and the rich text editor broke (playground session 55, caught by the
rich-text e2e suite). Any site with an older lockfile that upgrades Tapestry gets the same (reproduced in a scratch
project: 0.7.1 → 0.7.2 adds a second model, transform and view).

## Decision

Tapestry declares the `prosemirror-*` packages as caret ranges instead of exact versions, so the site's package
manager settles on one copy of each. The **lower bounds are the oldest versions a Tapestry release was tested with**
(0.7.1's: model `^1.25.12`, transform `^1.12.2`, view `^1.42.6`, history `^1.5.1`, schema-list `^1.5.1`, state
`^1.4.4`, commands `^1.7.2`, keymap `^1.2.3`), not the newest: pnpm reuses a version a site already has locked when
it satisfies the range, but adds a second copy when it doesn't. Ranges starting at the newest versions still
duplicated on upgrade (`^1.25.13` doesn't accept a locked 1.25.12). Raise a lower bound only when Tapestry needs a
newer version, and test that version. Everything else stays pinned exactly, and this repository's lockfile pins the
newest versions, which our tests and CI run. A second exception to `saveExact` (after ADR 0044's Preact runtime),
for packages that must exist once per site.

Checked in a scratch project (peers and scripts off): upgrading 0.7.1 → this release keeps one copy of each package
(the locked 0.7.1 versions); a fresh install gets one copy of each, the newest.

## Consequences

- Sites get one copy of each ProseMirror package, whichever versions satisfy every range.
- A site may run a newer minor or patch than our tests did (within major 1), or an older one down to the lower
  bound, which a release was tested with. ProseMirror follows semver closely and keeps 1.x compatible; releases
  keep testing the newest.
- ProseMirror publishes without provenance (ADR 0012): a site now accepts new 1.x releases without our review.
  Sites still control that with their own lockfile and `minimumReleaseAge`; our lockfile and CI see each release
  before we ship.
- A site whose lockfile has ProseMirror versions older than our lower bounds (from before Tapestry 0.7.1) can
  still get two copies; `pnpm update --depth Infinity "prosemirror-*"` settles it.
