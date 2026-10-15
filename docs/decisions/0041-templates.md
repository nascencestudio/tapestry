# 0041. Templates: shared header and footer parts

- Status: Accepted (the user's decisions, 2026-10-14); design by the assistant
- Date: 2026-10-14

## Context

Menus (and logos, footers, contact details) belong on every page, but Tapestry pages are built one
by one. The user proposed **templates** built with the same editor as pages: three regions (header,
body, footer), the body a fixed placeholder for the page's own content; pages show the template's
header and footer on the canvas, not editable, and pick their template from a menu in the editor
bar (like the language menu, next to SEO). This matches established practice: WordPress block
themes (templates with template parts and a "Post content" block), Drupal Canvas page regions,
Webflow/Framer page templates.

The user's decisions:

1. **Shared parts:** headers and footers are built once as named parts ("Main header"); a template
   picks one header and one footer. Editing a part updates every template using it.
2. **Draft, preview, publish, history** for parts, like pages (a part change reaches every page).
3. **Admins** edit parts and templates (Dashboard → Plugins → Tapestry → Templates, next to Text
   formatting). Editors choose a page's template.
4. Menus are a separate plugin (tapestry-menus, its own ADR); a Menu component goes into parts.

## Decision

### Data
- **Parts:** plugin data rows `tapestry-part:<id>`: `{ region: 'header' | 'footer', name, page }` where
  `page` is the stored page format (ADR 0011: published, draft, history, schedule), so revisions.ts,
  publish-guard rules (locked components) and validation apply unchanged.
- **Templates:** rows `tapestry-template:<id>`: `{ name, header: partId | null, footer: partId | null }`,
  and one setting for the **default template**. Templates are a form (name, two pickers), not an editor.
- **A page's template:** an optional `template` id on the page's document (format 1, optional key),
  so a change is a draft until published, and history keeps it. Missing or unknown → the default
  template. Existing pages need no migration.

### The site
- `getPage()` resolves the page's template and adds `regions: { header, footer }` (documents) to its
  result: published part versions for visitors; drafts for editors previewing (`?tapestry-preview`)
  and in the canvas. A part that was never published renders nothing for visitors.
- **`<Region name="header" page={result} />`** (`@nascencestudio/tapestry/Region.astro`) renders a region
  through the same pipeline as pages (StudioCMS renderer → sanitizer → registry → `Node.astro`).
  Sites place `<Region>`s in their layout around the page content. No JavaScript.

### The editors
- **Page editor:** a **Template** menu in the purple bar (after SEO, with a separator), listing
  templates with the current one checked. Changing it is a document edit (undo, draft). The canvas
  shows the template's header and footer, rendered but not selectable or editable.
- **Part editor:** Templates → a part → **Edit** opens the full Tapestry editor (library, layers,
  canvas, history) on a dashboard page, saving through `/_tapestry/parts` (admins, same origin)
  instead of StudioCMS's page form. Its canvas shows a real page (the home page, else the first
  published Tapestry page) with the part being edited in place and the body as a "Page content"
  placeholder.
- **Which document is editable** is decided in the browser from wrapper attributes, not by a
  per-request server flag (Astro renders sibling components concurrently): in canvas mode each
  region is wrapped in `<tapestry-region data-tapestry-region="header" data-tapestry-part="…">`;
  the canvas edits the root inside the region being edited, or the root outside any region (the
  page body), and ignores the rest.

## Alternatives considered

- **Each template owns its header and footer:** simpler, but sites with several templates would
  duplicate their header (offered; the user chose shared parts).
- **Saving a part makes it live at once:** offered; the user chose draft and publish.
- **Templates as StudioCMS pages of a hidden page type:** reuses StudioCMS's save and history, but
  they'd appear in the content tree, routes and REST API, and StudioCMS's own history rolls back
  the live version (known issue #21).
- **A server flag that turns canvas markers off inside regions:** racy with concurrent rendering.

## Consequences

- Sites add `<Region>`s to their layout (two lines). Pages keep working without them.
- Parts are language-neutral in the first version: a Menu inside follows the page's language;
  translated text in a header is later work.
- The editor gains a second save path (parts); page saves stay on StudioCMS's form.
