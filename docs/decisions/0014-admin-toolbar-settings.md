# 0014. Admins narrow rich text toolbars from the dashboard

- Status: Accepted (page location revised 2026-10-06, see "Revision")
- Date: 2026-10-06

## Context

Drupal lets site builders pick a text format's toolbar buttons in the admin UI.
Tapestry's toolbars (ADR 0012) were set only in code by developers. The user
asked for the Drupal-style option.

What StudioCMS 0.6.1 offers plugins (verified in source, see research notes):
- `dashboardConfig.settingsPage`: a generated form, but field defaults are
  fixed at config time, so it can't show what was saved last. Not usable for this.
- `dashboardPages.admin`: a full dashboard page with our own Astro component,
  permission-gated (`requiredPermissions: 'admin'`) and listed in the sidebar.
- `StudioCMSPluginData` (id → JSON) with `SDK.PLUGINS.usePluginData()`. Its
  insert and update are broken in 0.6.1 (they go through a cache that already
  holds the pre-write lookup, so the write is skipped or crashes; known issue #25).

## Decision

1. **Developers set the ceiling, admins narrow it.** The `toolbar` in
   `defineComponent()` lists the most a field can have. Admins can turn buttons
   off, never on beyond that list. Settings: `{ version: 1, fields: { "type.prop": buttons[] } }`;
   fields not listed use the developer's toolbar. Pure logic in `toolbar-settings.ts`.
2. **Dashboard page "Text formatting"** (`/dashboard/nascencestudio_tapestry/text_formatting`,
   admins only, shown only when a component has a rich text prop): one group per
   rich text field with a checkbox per developer-allowed button, prefilled with
   the saved choice. It posts a plain HTML form (works without JavaScript).
3. **Admins-only save endpoint** `POST /_tapestry/settings`: same-origin `Origin`
   check (CSRF), StudioCMS session with admin or owner level (fail closed),
   64 KB body limit, input cleaned against the manifest (unknown fields and
   buttons dropped), redirect back only to a same-origin path.
4. **Storage:** one row in `StudioCMSPluginData` (`@nascencestudio/tapestry-toolbars`, the
   id `usePluginData('@nascencestudio/tapestry', { entryId: 'toolbars' })` would use),
   read and written directly through the SDK's database client (`dbService.db`,
   a transaction: select, then update or insert), then StudioCMS's plugin-data
   cache is cleared. Read failures fall back to the developer toolbars.
5. **Editing only.** `Editor.astro` loads the settings and the editor uses a
   manifest with narrowed toolbars: buttons, shortcuts, paste, the JSON view and
   inline canvas editing all follow it. Stored content isn't rewritten and the
   public renderer keeps the developer's list, so changing a setting never
   changes a live page by itself. Existing formatting that's now disallowed
   disappears from a field the next time someone edits it (with a warning).

## Revision (2026-10-06): Plugins → Tapestry → Text formatting

The first version used `dashboardPages.admin`, which lists the page under
**Admin** in the sidebar. The user expected plugin settings under **Plugins**, as a
"Tapestry" entry with "Text formatting" as a section (more Tapestry settings
will follow). StudioCMS's Plugins section only lists plugins that declare a
`settingsPage`, one link each, pointing at a generated form that can't show
saved values. So:

- Tapestry declares an empty `settingsPage` (no fields; its required `onSave` module
  just answers 405), which puts **Tapestry** in the Plugins section.
- Tapestry injects its own page at the URL that link points to and renders it
  with StudioCMS's dashboard layout (`studiocms/frontend/layouts/DashboardLayout.astro`,
  exported by the package), with a double sidebar: Tapestry's sections on the inner
  side (just **Text formatting** for now).
- StudioCMS 0.6.1 builds that link without the slash after "plugins"
  (`/dashboard/plugins@nascencestudio/tapestry`, known issue #27), and its own
  `plugins/[plugin]` route can't match an id with a slash anyway, so Tapestry serves
  both `/<dashboard>/plugins@nascencestudio/tapestry` and the intended
  `/<dashboard>/plugins/@nascencestudio/tapestry`. The route's first segment is a
  parameter (plugins can't read StudioCMS's dashboard path at config time); the page
  answers 404 unless it equals the real dashboard path.
- The page checks the session itself: not logged in → login page, below admin →
  dashboard home. (A plugin dashboard page with `requiredPermissions: 'none'` would
  have been hidden from the Admin list, but `'none'` skips authentication entirely,
  so that was not an option.)
- The inner sidebar includes the mobile buttons StudioCMS's double-sidebar script
  expects (`#back-to-outer`, `#show-page`).

## Revision (2026-10-06): settings store what's turned off

Settings first listed the *enabled* buttons. When the developer then added new
toolbar entries (heading levels, alignment…), they stayed hidden until an admin
enabled them. Format 2 stores the buttons admins turned **off**
(`{ version: 2, disabled: { "text.body": ["italic"] } }`), so new developer buttons
appear by default. Format 1 rows are still read (anything not listed counts as off).

## Alternatives considered

- **Apply the admin settings on the public site too.** Unchecking a box would
  strip formatting from published pages immediately, without anyone publishing.
  That breaks the draft/publish guarantee (ADR 0011).
- **StudioCMS's `settingsPage` form.** It can't show saved values.
- **`usePluginData()` as documented.** It doesn't persist in 0.6.1 (#25).
- **Config file only.** That's the developer ceiling; the user wanted admins to choose.
- **Per-role toolbars** (editors vs admins). Possible later.

## Consequences

- Editors get new toolbars the next time they open a page (the editor reads
  settings when it loads).
- A field whose developer toolbar loses a button keeps working: saved settings
  are re-cleaned against the current manifest on every read.
- e2e: a settings suite (6 steps) covers the endpoint's refusals (anonymous,
  forged session, cross-origin), the developer ceiling, no off-site redirects,
  the page and its saved state, the editor's narrowed toolbar and paste, and
  that published pages are unaffected.
- When StudioCMS fixes `usePluginData()`, the store can switch to it without migrating data.
