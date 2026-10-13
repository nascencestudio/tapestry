# 0040. The SEO button: Tapestry's hook for tapestry-seo

- Status: Accepted (the user's decisions, 2026-10-11/12)
- Date: 2026-10-12

## Context

ADR 0039 decided that per-page SEO lives in `@nascencestudio/tapestry-seo` and is edited from an
**SEO** button in Tapestry's editor bar, saved at once rather than with the page's draft. Tapestry
must not depend on tapestry-seo (most sites may not install it), and tapestry-seo needs a few of
Tapestry's build-time modules: the media library lookup (`virtual:tapestry/media`) for social images,
the media picker (`virtual:tapestry/media-client`) and the runtime config (`virtual:tapestry/config`)
for page paths.

## Decision

1. **Detection like the media library** (ADR 0016): at build time Tapestry resolves
   `@nascencestudio/tapestry-seo/editor` from the site's root. New option `seo` (default: on when
   installed; `false` turns the button off).
2. **`virtual:tapestry/seo-client`** exports `loadSeoEditor`: a dynamic import of that entry, or null.
   `Editor.astro` passes it to `mountEditor({ seoEditor })`; the button appears only when it's set
   and the page has an id. Nothing of tapestry-seo loads until the button is used.
3. **The dialog belongs to tapestry-seo.** Tapestry calls `openSeoEditor({ pageId, loadPicker })`
   and knows nothing about SEO fields, storage or permissions. tapestry-seo renders its own
   `<dialog>` (like the media picker) and saves through its own endpoint (`/_seo/page`, editors
   only). The button isn't disabled when the page content is unreadable: SEO is stored separately.
4. **Tapestry's virtual modules are a contract for companion plugins**: `virtual:tapestry/config`,
   `virtual:tapestry/media` and `virtual:tapestry/media-client` may be imported by Nascence Studio
   plugins that require Tapestry (both run in the same Vite build). Changing their exports is a
   breaking change for those plugins.

## Alternatives considered

- **Tapestry renders the SEO form itself** from a field list tapestry-seo provides: one modal style,
  but SEO knowledge (previews, image rules, defaults) would leak into Tapestry, and every new field
  would need a Tapestry release.
- **A general "editor extensions" API** (any plugin adds buttons): more than one known consumer
  would justify it; with one, the media-library pattern is simpler and already proven.

## Consequences

- Tapestry 0.4.0 has the button; tapestry-seo 0.2.0 requires it.
- tapestry-seo depends on Tapestry's virtual module exports (decision 4).
