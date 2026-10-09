# 0011. Drafts, publishing and version history inside the stored content

- Status: Accepted
- Date: 2026-10-05

## Context

Until now, every Save went live immediately. The user asked for a Drupal-style
workflow, scoped to Tapestry pages only:

- Saving keeps changes as a **draft**; visitors keep seeing the published page.
- A deliberate **Publish** makes the draft live.
- A **history of the 5 previous published versions**, any of which can be restored.
- Discard unpublished changes; preview the draft before publishing.

StudioCMS 0.6 has a page-level `draft` flag. It hides or shows a whole page and
can't keep a published version live while another is being edited. It also has
"Edit History" (diffs), which records every save without telling drafts and
published versions apart. Plugins can't add database tables, and the dashboard
saves exactly one content string per page (the `page-content` textarea).
(Correction, 2026-10-06: plugins *can* create tables at config time, as the built-in
Web Vitals plugin does. Keeping versions in the content remains the simpler choice:
one write path, and StudioCMS's own save and permissions.)

## Decision

1. **All versions live in the page's stored content (format 2).**
   ```ts
   { version: 2, published, publishedAt, publishedBy?, draft, history: [{ document, publishedAt, publishedBy? }] }
   ```
   `published` is `null` until the first publish. `draft` is `null` when there are
   no unpublished changes. `history` is newest first, capped at `historyLimit`
   (default **5**, a plugin option). Pure functions in `revisions.ts` (`saveDraft`,
   `publish`, `discardDraft`, `restoreToDraft`, `documentFor`, `pageStatus`) carry
   all the logic and are unit-tested. Spec: [data-model.md](../data-model.md#stored-page-format-2).
2. **Backwards compatible on read.** A format-1 document (pages saved before
   this change) reads as *published with no draft*. `""` (a new page) reads as
   *never published*. Nothing is migrated in the database: a page converts to
   format 2 on its next save.
3. **Visitors only ever get `published`.** The renderer and `getPage()` render
   the published document. Editors see the draft only when they ask for it
   (`?tapestry-preview`, plus the canvas). Never-published pages are a 404 for
   visitors. `getPage()` copies the page object instead of changing it, because
   StudioCMS caches page objects across requests.
4. **StudioCMS's JSON responses are redacted too.** StudioCMS's anonymous REST
   API (`/studiocms_api/rest/v1/public/pages`) returns stored content verbatim and
   can't be switched off. A plugin-added Astro middleware rewrites any JSON
   response that contains Tapestry content for non-editors: `content` becomes the
   published document only, and never-published pages are dropped from lists (or
   answered with 404). It matches on the response body rather than the URL
   because StudioCMS's router accepts many spellings of the same path. It fails
   closed (500, never the raw body).
5. **The editor builds the stored page; StudioCMS saves it.** The editor works on
   the draft (or the published version). After the first edit it writes the
   whole stored page into the `page-content` field. **Save draft** (and
   StudioCMS's own Save button) store it with the edits as `draft`. **Publish**
   moves the current published version into history, makes the editor's document
   the published one, and submits the form. **Restore** and **Discard** load an
   older version or the live one into the editor as an undoable edit. Nothing
   goes live until Publish.
6. **UI.** Toolbar status pill (Not published yet / Published / Unpublished
   changes), **Save draft**, **Publish** (disabled when there's nothing to
   publish or the content is invalid), and a **History (n)** panel. The admin bar
   on the site shows the same status, with "Preview draft" and "View published" links.

## Alternatives considered

- **StudioCMS's `draft` flag.** Takes the whole page offline. It can't keep the
  old version live while the new one is edited.
- **StudioCMS Edit History as the version list.** It records every save
  (including drafts), stores diffs, isn't scoped to publishes, and restoring a
  diff restores the *whole* stored page, including `published`.
- **Separate storage (own table, or the plugin-data fields).** Plugins can't add
  tables. Plugin data is per-page key/value metadata saved through the same form,
  so it adds no safety and splits the state across two places that can disagree.
- **Duplicate pages for drafts ("Home (draft)").** Breaks slugs, navigation and
  links, and clutters the content list.
- **Publishing on the server with a dedicated endpoint.** Possible later. It would
  need its own CSRF and permission checks and would duplicate StudioCMS's save
  path. Building the stored page in the editor and saving through StudioCMS's
  own form keeps one write path, which StudioCMS already authenticates.

## Consequences

- Stored content is bigger: up to `historyLimit + 2` documents (the size limit
  scales the same way: 1 MB × 7 by default). Each document is still validated
  and limited on its own.
- **Editors can still put anything in the content** (it's untrusted input, as
  before). Every document inside, history included, goes through
  `validateDocument()` on read. Faking `publishedBy` or dates only affects how
  the History panel labels versions.
- **Existing pages behave differently after upgrading:** a Save no longer
  updates the live page; editors must click Publish. Documented in the
  editor guide and the README.
- StudioCMS's own **Save Changes** button saves a draft. The editor's **Save
  draft** does exactly the same thing.
- StudioCMS's **Edit History** keeps working, but reverting there restores the
  whole stored page (published version, draft and history together). Use
  Tapestry's History panel instead (known issue #21).
- JSON responses that contain Tapestry content cost one session check and a
  parse for non-editors. Other responses pass through untouched (a substring
  check on JSON bodies only).
- Token-authenticated REST API clients (no dashboard session) also get only the
  published version. That's a safe default; a raw-access option can be added if
  someone needs it.
- e2e: a publishing suite (11 steps) covers drafts, preview isolation (including
  StudioCMS's page cache), the REST API under several path spellings, canvas,
  publish, restore, discard, the history cap and never-published pages.
