# Admin bar and safe page loading

Tapestry gives StudioCMS sites a Drupal-style **admin bar** on the public site for
logged-in editors, plus a page loader that **keeps draft pages private**. Both
work for every StudioCMS page type, not just Tapestry pages.

Decision record: [ADR 0009](decisions/0009-server-rendered-admin-bar.md).

## What editors get

When a logged-in editor (or admin or owner) views any page on the site, a dark
bar appears at the top:

| Item | Goes to |
| --- | --- |
| **Dashboard** | the StudioCMS dashboard |
| **Content** | the content list |
| **Add page** | the create-page screen |
| Status badge + page title | (status only): **Draft** (StudioCMS draft page), and for Tapestry pages **Not published yet**, **Unpublished changes** or **Published** |
| **Preview draft** / **View published** | Tapestry pages with unpublished changes: switch between the draft (`?tapestry-preview`) and the live version |
| **Edit page** | this page's editor in the dashboard |
| your name, **Log out** | StudioCMS's logout |

In the other direction, the Tapestry editor's canvas bar has a **View page**
button (next to reload) that opens the saved page in a new tab.

Anonymous visitors get **nothing**: no bar markup, no CSS, no JavaScript, and no
extra database work.

## Setup (two small changes to your site)

### 1. Load pages with `getPage()`

```astro
---
// src/pages/[...slug].astro
import { StudioCMSRenderer } from 'studiocms:renderer';
import { getPage } from '@nascencestudio/tapestry/page';
import Layout from '../layouts/Layout.astro';

const result = await getPage(Astro);
if (!result) return new Response(null, { status: 404 });
const { page, viewer, publishing } = result;
---
<Layout title={page.title} viewer={viewer} page={page} publishing={publishing}>
  <StudioCMSRenderer data={page} />
</Layout>
```

> ⚠️ **Don't use `SDKCoreJs.GET.page.bySlug()` directly in public routes.** It
> doesn't filter drafts, so a draft page would be served to anyone who guesses
> its URL. (StudioCMS's own `@studiocms/blog` route has this problem as of 0.5.0.)

`getPage(Astro, { slug? })`:

- Uses `Astro.params.slug` (or `'index'`) unless you pass `slug`.
- Returns `null` if the page doesn't exist, **or** if it's a draft and the viewer
  isn't an editor. Both should be a 404, so drafts don't reveal that they exist.
- Sets response headers:
  - `Cache-Control: private, no-store` on every response rendered for an editor
    (it contains the admin bar, and possibly draft content).
  - `X-Robots-Tag: noindex, nofollow` on drafts.
- Turns on **canvas mode** when an editor requests the page with `?tapestry-canvas`
  (the editor's visual canvas does this). It's ignored for everyone else. The canvas
  only works on routes that use `getPage()`.
- For **Tapestry pages**, picks the version to render ([ADR 0011](decisions/0011-draft-publish-history.md)):
  visitors always get the **published** version, and a page that was never
  published returns `null` for them (404). Editors get the published version too,
  unless they add `?tapestry-preview` (or are in the canvas): then they get the
  unpublished draft, with `noindex`.
- Returns `{ page, viewer, publishing? }`. `viewer` is `{ isLoggedIn, permissionLevel, user }`.
  `publishing` (Tapestry pages only) is `{ status, publishedAt, previewing }`, where
  `status` is `'unpublished' | 'published' | 'changed'`. Pass it to the admin bar.

To check the session yourself (e.g. on a custom route), use
`getViewer(Astro)` from the same module.

### 2. Add the bar to your layout

```astro
---
import AdminBar from '@nascencestudio/tapestry/AdminBar.astro';
const { viewer, page, publishing } = Astro.props;
---
<body>
  <AdminBar viewer={viewer} page={page} publishing={publishing} />
  <slot />
</body>
```

Put it first in `<body>`; it's `position: sticky` at the top. `page` is optional
(omit it on pages that aren't StudioCMS pages, and the page-specific items disappear).
`publishing` is optional too; without it, Tapestry pages show only the basic badge.

### 3. Turn off StudioCMS's corner menu (recommended)

StudioCMS injects its own logged-in "Quick Tools" corner menu, an ~18 KB script,
into **every** public page for every visitor. With the admin bar you don't need it:

```js
// studiocms.config.mjs
export default defineStudioCMSConfig({
  features: {
    injectQuickActionsMenu: false, // must be under `features`; a top-level key is silently ignored
  },
  // ...
});
```

In the playground this cut public-page JavaScript from 18,714 bytes to 174 bytes.

### 4. Markdown pages: add their CSS where it's needed

The Markdown plugin is patched so it no longer adds its CSS to every page (known issue
#33). If your site has Markdown pages, inline it in the layout for those pages only:

```astro
---
import markdownCss from 'studiocms:md/styles-inline';
const { page } = Astro.props; // from getPage()
---
<head>
  {page?.package === 'studiocms/markdown' && <style is:inline set:html={markdownCss} />}
</head>
```

### 5. A "not found" page of your own

Without one, StudioCMS serves its own 404, which renders the whole dashboard layout
(~190 KB) for visitors (known issue #34). Add `src/pages/404.astro` with your site's
layout, and stop StudioCMS from injecting its page (otherwise the routes collide):

```js
// studiocms.config.mjs
features: { dashboardConfig: { inject404Route: false } },
```

`getPage()` returning nothing → `return new Response(null, { status: 404 })` then shows
your page.

### 6. Optional: translations

With `tapestry({ languages: ['en', 'fr'] })`, editors can create a French version of any
Tapestry page (its own page, slug `fr/<slug>`). `getPage()` then also returns the page's
`language` and the `translations` the viewer may see:

```astro
---
const { page, language, translations = [] } = result;
const versions = translations.length > 1 ? translations : [];
---
<html lang={language?.code ?? 'en'}>
  <head>
    {versions.map((t) => <link rel="alternate" hreflang={t.lang} href={new URL(t.path, Astro.url).href} />)}
  </head>
  <body>
    <nav aria-label="Languages">
      {versions.map((t) => t.current
        ? <span aria-current="page" lang={t.lang}>{t.label}</span>
        : <a href={t.path} hreflang={t.lang} lang={t.lang}>{t.label}</a>)}
    </nav>
```

Your catch-all route (`[...slug].astro`) already serves `/fr/about`. Page links inside
Tapestry content follow the page's language. See [ADR 0032](decisions/0032-translations.md).

### 7. Optional: page URL pattern

The editor's "View page" button builds the URL from the page slug with
`pageUrlPattern` (default `/{slug}`; the `index` slug maps to `/`):

```js
tapestry({ components, pageUrlPattern: '/{slug}' })
```

## How it works

- **Session check.** StudioCMS only resolves the logged-in user for dashboard
  and API routes. `getViewer()` calls StudioCMS's own
  `User.getUserData()` (from `studiocms:auth/lib`), the same code the dashboard
  uses. With no `auth_session` cookie it returns immediately; with a cookie it
  validates the session (one database lookup). Invalid or forged cookies are
  treated as anonymous, and any error fails closed.
- **Rendering.** `AdminBar.astro` renders only when `isEditor(viewer)` is true.
  Its CSS is an inline `<style>` emitted together with the bar, so nothing reaches
  anonymous visitors. `all: initial` plus ID-anchored selectors (`#tapestry-adminbar`)
  keep site styles from leaking in. Site rules using IDs or `!important` could still
  override it.
- **Links** come from StudioCMS's route map, so a customized dashboard path still works.

## Caveats

- **Shared caches / CDNs.** Editor responses are `private, no-store`, so they're
  never stored. Anonymous responses carry no cache headers from Tapestry; if a CDN
  caches them, editors may see the cached (bar-less) version until they bypass it.
  We don't add `Vary: Cookie`, because that would defeat caching for everyone.
- **Content Security Policy.** The bar's inline `<style>` needs `style-src 'unsafe-inline'`
  or a nonce, *for editors only*. A nonce option can be added if needed.
- The bar is shown to `editor`, `admin` and `owner` levels. `visitor` accounts
  don't see it and can't see drafts.
