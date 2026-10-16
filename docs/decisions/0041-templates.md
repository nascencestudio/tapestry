# 0041. Templates: shared headers, footers and page layouts

- Status: Accepted (the user's decisions, 2026-10-14 and 2026-10-15); design by the assistant
- Date: 2026-10-15 (revised the same week, before release)

## Context

Menus, logos and footers belong on many pages, but Tapestry pages are built one by one. The user
asked for **templates** built with the same editor as pages. A first version (headers and footers
only, chosen per page) was revised after trying it: templates should be reusable **page layouts**
that pages inherit, with layout and content components of their own. This matches established
practice: WordPress block themes (templates, template parts, a "Post content" block), Drupal Layout
Builder and Canvas page regions, Webflow/Framer page templates.

The user's decisions:

1. **Template Management** is its own dashboard item, right under Media, with two sub-pages:
   **Headers and Footers** (shared parts, as before) and **Templates**.
2. **Shared parts:** headers and footers are built once and chosen by templates (and one-off pages).
3. **Templates are inherited:** a template's body (any components) is fixed and shared; it contains
   one or more named **content areas** (Main, Sidebar…) that pages fill. Changing the template
   changes every page using it, except their own area content.
4. **Fixed template content is locked** on pages (per-field overrides may come later).
5. **One-off pages** (no template) start with no header or footer; editors can add an existing
   header and footer (they can't create parts there).
6. Parts and templates have **draft, preview, publish and history**; **admins** edit them; editors
   choose a page's template, header and footer.
7. Menus are a separate plugin (tapestry-menus); a Menu component goes into parts or templates.

## Decision

### Data
- **Parts:** rows `tapestry-part:<id>`: `{ id: 'tp_…', region, name, page }`, `page` the stored page
  format (ADR 0011).
- **Templates:** rows `tapestry-template:<id>`: `{ id: 'tt_…', name, header, footer, page }`. `page`
  holds the template body (draft, publish, history). Header and footer are settings of the template.
- **Content area:** a built-in component, type `tapestry-area`, prop `name`; its area key is the
  slugified name (`Main` → `main`). Only offered in the template editor.
- **A page document** (keys in this order; documents are compared as strings):
  `{ version, template?, header?, footer?, root }`. With `template`, the page's top-level nodes carry
  `slot` = the area key they belong to; `header`/`footer` are ignored (the template's apply). Without
  one, `header`/`footer` are the page's own choice (absent: none).

### Rendering
- `getPage()` resolves the template (published for visitors; drafts for editors previewing and in
  the canvas), adds `regions` (header, footer) and **merges** the page into the template body: each
  content area gets the page's nodes for its key (`mergeTemplate()`, pure). Template node ids are
  prefixed `tpl_` so they can't collide with page ids. The merged document goes through the normal
  pipeline. Page content whose area no longer exists is not rendered (the editor shows it).
- `<Region name="header|footer">` renders the header/footer (unchanged).
- The render endpoint merges too when the canvas sends a template id.

### Editing
- **Page editor:** the Template menu lists "No template" (with header/footer pickers) and the
  templates. With a template, the document root has the template's areas as its slots: the layer
  tree groups top-level components by area, the canvas shows template content faded and locked
  (`tpl_` nodes are never selectable) and each area as a drop zone. Switching templates moves
  content to the area with the same key, else the first area (one undoable change).
  With no templates, headers or footers yet, the button stays in the bar, disabled, reading "No
  available templates" (the user, 2026-10-16: before, it disappeared and left its separator behind).
- **Template editor / part editor:** the full editor on the Template Management page, saving through
  `/_tapestry/parts` (parts and templates; admins; the same save rules as pages). The canvas shows a
  real page: the template body (areas as labelled placeholders) or the part in place.
- **Which root is editable** is decided in the browser from wrapper attributes, never by a
  per-request server flag (Astro renders siblings concurrently).

## Alternatives considered

- **Header/footer-only templates** (the first version): too little; pages couldn't share layout.
- **Templates as starting points (copied):** offered; the user chose inheritance.
- **A single content area:** offered; the user chose named areas.
- **Templates as StudioCMS pages of a hidden page type:** they'd appear in the content tree, routes
  and REST API, and StudioCMS's own history rolls back the live version (known issue #21).

## Consequences

- Sites add `<Region>`s to their layout (two lines); the template body arrives through the normal page
  rendering.
- Renaming a content area moves pages' content out of it; it stays in the document and the editor
  offers it for placing again.
- Parts and templates are language-neutral for now; Menu components inside follow the page's language.
