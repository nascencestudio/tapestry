# 0039. Listing public pages; the tapestry-seo plugin

- Status: Accepted (the user's decisions, 2026-10-10/11)
- Date: 2026-10-11

## Context

The user wants SEO handled by a plugin of its own: a generated `robots.txt` with an
admin-controlled list of crawlers to block (AI crawlers in particular), a `sitemap.xml`, and
per-page SEO settings with meta tags. StudioCMS has no hook for adding a tab to its page edit
screen, so the user decided to tie the plugin to Tapestry: **`@nascencestudio/tapestry-seo`**
(its own repository), with an **SEO** button in Tapestry's editor bar for the per-page settings.
Pages of other types (Markdown…) get no SEO editor; they still appear in the sitemap and get
meta tags from their StudioCMS title and description. SEO changes save immediately, not with
the page's draft/publish cycle.

A sitemap must list exactly the pages visitors can see, and Tapestry's rules for that (no
StudioCMS drafts; Tapestry pages only once published, scheduled versions once due; translations
only when visible) live in Tapestry. Re-implementing them in another package would drift.

## Decision

1. Tapestry exports **`listPublicPages()`** from `@nascencestudio/tapestry/page`: every page
   visitors can see right now, with its public path (`pageUrlPattern`), title, description, page
   type, last change, language and visible translations. The rules are one pure module
   (`public-pages.ts`), the same ones `getPage()` and the language switcher apply.
2. tapestry-seo builds its sitemap from that list, and later its meta tags.
3. Stage 2 adds the SEO button to the editor, found the same way Tapestry finds the media library
   (optional peer, build-time virtual module).

## Consequences

- One definition of "public" for pages, routes and listings.
- tapestry-seo requires the Tapestry version that has `listPublicPages()`.
