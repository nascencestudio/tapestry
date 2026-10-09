# 0032. Translations: one page per language, linked in a group

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 5 lists "i18n (StudioCMS content languages)". What StudioCMS 0.6.1 offers
(verified in its source):

- The data model has one `StudioCMSPageContent` row per language (`contentLang`)
  and the SDK returns them all (`multiLangContent`).
- The dashboard only ever reads and writes `contentLang: 'default'`: there is no UI
  to add or edit another language, and no routing by language.
- The page's **title, slug and description** live on the page, not the content row,
  so they can't be translated in that model.

## Decision

1. **Each language version is its own StudioCMS page** (a Tapestry page), linked
   into a **translation group**. The default-language page is the group's source;
   every translation has a plugin-data row `@nascencestudio/tapestry-language:<pageId>`
   = `{ lang, source }`. Everything Tapestry already does (editor, canvas, drafts,
   history, scheduling, permissions) works per language without changes, and titles,
   slugs and descriptions are translatable.
2. **Option** `tapestry({ languages: ['en', 'fr'] })` (or `{ code, label }`); the
   first is the default language, which is what the site's existing pages are.
   Labels default to each language's own name (`Intl.DisplayNames`).
3. **Creating a translation** (editor: translations menu in the toolbar, or
   `POST /_tapestry/translations`, editors, same-origin): a new page copying the
   original's settings, title "About (Français)", slug `fr/about` (`fr` for the home
   page; `-2`, `-3` if taken), the original's working version as an **unpublished
   draft**, so visitors see nothing until it's translated and published. The editor
   then opens it. The menu lists every language with each version's status.
4. **On the site**, `getPage()` returns `language` and `translations` (the versions the
   viewer may see: visitors only get published, non-draft pages) for `<html lang>`,
   `<link rel="alternate" hreflang>` and a language switcher (the playground's layout
   has all three, zero JS).
5. **Links follow the language:** a page link on a French page goes to the linked
   page's French version when there's one the viewer may see, else to the original.

## Alternatives considered

- **StudioCMS content-language rows** (the roadmap's wording): no dashboard support,
  so Tapestry would need its own save path for every non-default language (around
  StudioCMS's form, publish guard and caches), and titles, slugs and descriptions would
  stay in one language. Rejected.
- **Translations inside one stored page** (`translations: { fr: … }`): same problems,
  plus one huge record and per-language publishing inside it.
- **Field-level translation of one shared tree** (Drupal-style): keeps structure in
  sync, but languages often need different structure; copies are simpler and allow it.

## Consequences

- Translations appear in StudioCMS's page lists like any page (title says the language).
- Deleting a page leaves its translation row; rows for missing pages are ignored.
- The canvas's live re-renders don't localize links (the render endpoint has no page
  context); the page itself (and the preview) does.
- e2e suite `translations` (8 steps).
