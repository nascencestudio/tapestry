# 0021. Keep dashboard CSS off public pages (three dependency patches)

- Status: Accepted
- Date: 2026-10-06

## Context

The user viewed the playground's home page logged out and found dozens of inline
`<style>` tags for things that don't exist on the page. Measured:

| | Before | After |
| --- | --- | --- |
| Production public page | 7.4 KB HTML + `DashboardLayout.css` 54 KB, `BaseLayout.css` 13 KB, `library.css` 8 KB, Markdown CSS 1.9 KB inline | 5.3 KB HTML, only the site's own CSS (3.2 KB inline) |
| Dev public page | 295 KB, 102 `<style>` tags | 10 KB, 6 tags (site layout + the components on the page) |

Rule 2 of the project ("light and fast: public pages ship nothing they don't need")
was being broken, and known issue #2 had been open since the first session.

Tracing the build's module graph (a temporary Vite plugin replaying Astro's CSS walk)
found three independent causes:

1. **StudioCMS's middleware imports a dashboard component.** Every page's graph reaches
   Astro's `virtual:astro:manifest` (via `astro:config/server`, or Astro's middleware
   helpers that StudioCMS's effect layer imports), the manifest includes the middleware,
   and the middleware imported `studiocms:i18n`, which also exports `LanguageSelector.astro`.
   Its StudioCMS UI components share CSS bundles with the dashboard layout, so Astro
   attached the dashboard's CSS files to every route, even JSON endpoints.
2. **Astro 7's dev CSS collector** walks through the manifest into every page, so in
   `astro dev` every page gets every page's CSS (and the dashboard gets the site's
   global CSS: known issue #14).
3. **@studiocms/md injects its CSS into every page** (`injectScript('page-ssr')`).

Plus one of ours: the media library imported `library.css` from browser scripts, and
Astro's script-to-page mapping crosses the manifest too, so it went everywhere.

## Decision

- **Patch StudioCMS** (one line): the middleware imports `defaultLang` from the plain
  i18n config module instead of `studiocms:i18n`.
- **Patch Astro** (dev only, a few lines): the dev CSS collector doesn't walk into
  `virtual:astro:manifest`, matching production, where pages are boundaries.
- **Patch @studiocms/md**: no global injection; a new `studiocms:md/styles-inline`
  module exports the CSS as a string, and the site layout inlines it on Markdown pages
  only (documented in the site guide).
- **Media library**: loads its stylesheet on demand (`?url` + a `<link>` added when the
  library or picker opens), never via a CSS import in browser code.
- All patches go through `pnpm patch` with a reason and an exit condition in
  `pnpm-workspace.yaml`; pnpm refuses to install if one stops applying. The Dockerfile
  copies `patches/` before installing.
- A first attempt also replaced StudioCMS's `astro:config/server` imports with
  `import.meta.env.SITE`. It wasn't enough on its own (the effect layer reaches the
  manifest anyway) and wasn't needed once the middleware edge was cut, so it was dropped
  to keep the patch minimal.

## Alternatives considered

- **Strip tags from HTML responses in middleware.** Fragile (hashed file names, inline
  styles) and treats the symptom.
- **Remove @studiocms/md.** StudioCMS's create form hard-codes the Markdown type
  (known issue #15), so it must stay installed.
- **Remove the 174-byte transition-event polyfill** that @studiocms/ui injects. The
  dashboard's scripts rely on the `astro:page-load` event it fires, and Astro can't
  inject a script into only some pages. Left in place (documented in known issue #2).
- **Wait for upstream fixes.** The issues are now understood well enough to report
  (when the user asks); the patches are tiny and fail loudly on upgrade.

## Consequences

- Public pages carry only their own CSS, in dev and production; known issues #2 and #14
  are resolved.
- Three patched dependencies to re-check on every upgrade (pnpm enforces it).
- Rule for plugin code: never import CSS from browser scripts (use `?url` and add a
  `<link>` when the UI opens); component CSS imported server-side stays per route.
