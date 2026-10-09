# 0015. Packages under the @nascencestudio scope

- Status: Accepted
- Date: 2026-10-06

## Context

The project is published by the user's business, Nascence Studio, and now has
a second package (the media library). The plugin was `@tapestry/studiocms`.

## Decision

- All packages use the npm scope **`@nascencestudio`**: `@nascencestudio/tapestry`
  (was `@tapestry/studiocms`) and `@nascencestudio/medialibrary`. Directories stay
  `packages/tapestry` and `packages/medialibrary`.
- The StudioCMS plugin identifier follows the package name, so Tapestry's
  dashboard page is now `/dashboard/plugins@nascencestudio/tapestry`.
- Saved toolbar settings move to row `@nascencestudio/tapestry-toolbars`; the old
  row (`@tapestry/studiocms-toolbars`) is still read when the new one doesn't exist.
- Older devlog entries keep the old name (history).

## Consequences

- Publishing to npm needs the `@nascencestudio` organization on npmjs.com (free
  for public packages), and publishing with provenance (roadmap, Phase 5).
- Site code imports `@nascencestudio/tapestry`, `@nascencestudio/tapestry/page`,
  `…/AdminBar.astro`, `…/RichText.astro`, and `@nascencestudio/medialibrary`.
