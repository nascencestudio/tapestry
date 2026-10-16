# 0042. Hooks for companion plugins: server choices, link resolution, editor buttons

- Status: Accepted (2026-10-16), for @nascencestudio/tapestry-menus
- Date: 2026-10-16

## Context

tapestry-menus (its ADR 0001) adds menus edited in the dashboard, Menu and Breadcrumbs components for
Tapestry's library, and a **Menu** button in the page editor ("add this page to a menu"). It needs
three things from Tapestry:

1. A Menu component chooses one of the site's menus, which only exist at runtime: a `select` prop has a
   fixed list of options.
2. Menu links must behave exactly like Tapestry's link props: page ids resolved to current paths, in
   the page's language, unpublished pages hidden from visitors.
3. A second editor-bar button after SEO's (ADR 0040), which said to generalize at the second consumer.

## Decision

1. **`select` props may take `optionsUrl`**: a path on this site (checked: no scheme, `//` or `..`)
   answering editors with `{ options: [{ value, label }] }`. The settings panel loads it once per URL
   and keeps showing a value that's no longer offered ("Missing: …"). Values are then ids
   (`[A-Za-z0-9_-]{1,100}`): the validator can't know the live list, so components must handle a value
   that no longer exists (render nothing). Static `options` may be empty.
2. **`resolveSiteLinks(Astro, values, { hideUntranslated })`** from `@nascencestudio/tapestry/page`:
   the same resolution as `Node.astro`'s link props (`resolveLinks`, draft access, the page's
   language). With `hideUntranslated`, a page link without a visible version in the current language
   resolves to null instead of the original (menus leave such links out).
   `cleanLinkValue()` (the link props' validation) is exported too, so menus store links in the same
   canonical form; with `isSafeUrl()` also from `@nascencestudio/tapestry/links`, which is safe in the
   browser (the main entry is the server-side plugin).
   `pageLanguage(Astro)` gives the shown page's language code (menu labels per language).
   `inEditorCanvas(Astro)` tells components they render in the editor's canvas (placeholders).
3. **Companion buttons**: `COMPANIONS` lists the known companion plugins (entry, button label, the
   function their editor module exports). At build time Tapestry resolves the installed ones;
   `virtual:tapestry/extensions` exports them, each loading its module on demand; the editor bar shows
   a button per companion (SEO, Menu). Options `seo` / `menus` turn one off. A companion's function is
   called with `{ pageId, loadPicker }` and owns its dialog and data.

## Consequences

- Tapestry 0.6.0 (on top of 0.5.0's templates).
- `virtual:tapestry/seo-client` is replaced by `virtual:tapestry/extensions` (tapestry-seo itself is
  unchanged: Tapestry still calls its `openSeoEditor`).
- A new companion needs a line in `COMPANIONS` (a Tapestry release), which keeps the list reviewed.
