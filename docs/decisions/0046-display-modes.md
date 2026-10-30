# 0046. Display modes: templates that show a page in more than one way

- Status: Accepted (the user, 2026-10-23); built in Tapestry 0.7.0 (below)
- Date: 2026-10-23

## Context

The user wants Drupal-style display modes without content types (playground session 49). A page's kind is its
categories and tags, its look is its template (ADR 0041), and a **display mode** says how big it's shown: **Full**
(the page itself) or **Teaser** (a card in a list), and up to 14 more modes that admins add. A companion plugin,
`@nascencestudio/tapestry-fabric` (its ADR 0001), adds the Display Modes dashboard page and the list component that
shows other pages in a mode. An earlier attempt with fields and content templates was removed (sessions 44–46:
templates inside templates confused people); this one reuses templates and content areas as they are.

Display modes have to reach deep into Tapestry: template documents, content areas, the page editor's canvas and
the renderer. So the machinery lives here, inert until a companion supplies the list of modes.

## Decision

### Modes
- A mode is `{ key, name }`; keys match `/^[a-z][a-z0-9-]{0,31}$/` and never change. `full` always exists and is
  the default; `teaser` is the other built-in. Companions supply the list (Fabric stores it; at most 16). Without
  a companion there are no modes and nothing below appears.

### Template components get "Shown in"
- In template bodies only, every component, content areas included, gets a **Shown in** field (chips with
  autocomplete over the modes) in the settings panel. New components start with Full.
- Stored as a node key `modes: ["full", "teaser"]`, only in template documents (validated there; dropped
  elsewhere). Canonical key order: id, type, label, slot, modes, props, children. A node without `modes` is in
  Full only (every existing template keeps working unchanged).
- A container's children show only in modes both they and the container are in.

### Content areas get a tab per mode
- A content area shown in more than one mode holds separate content for each: on a page's canvas its label reads
  `Content area: Main | Full | Teaser`, and the tabs switch what the area shows and edits. An area in one mode has
  no tabs. The page structure panel shows the same split (Main › Full, Main › Teaser).
- Storage: a page's top-level nodes already carry `slot` = the area key (ADR 0041). Full keeps that; other
  modes use `key.mode` (`main.teaser`). `.` can't occur in either part, so the split is unambiguous.
- Content for a mode the area no longer has (or a deleted mode) is kept, not shown and has no tab; it comes back
  if the mode does.

### Rendering in a mode
- `mergeTemplate(template, page, mode = 'full')` keeps the template components shown in `mode` and fills each
  area with that mode's content. Visitors to a page always get Full: nothing changes for existing sites.
- New export for companions in `@nascencestudio/tapestry/page`: `pageInMode(page, mode)` → the merged
  **published** document for that page in that mode, or `null` (not a Tapestry page, no template, nothing in that
  mode). Always the published version, even in the editor's canvas: a list shows what visitors would see.
- Documents rendered inside a component (a list's items) are **foreign** to the page being edited: the renderer
  marks their root and the canvas never selects, edits or drops into anything inside it (as with template nodes,
  ADR 0041).

### Multiple choices in a `select`
- `select` props gain `multiple: true` (a list of option values; with `optionsUrl` too). Fabric needs it for
  categories and tags; it's generally useful.

### Small editor change on the side
- The canvas chip's Duplicate and Delete buttons get drawn icons (two squares; a trash can) instead of the `⧉`
  and `✕` characters (the user's request).

## Alternatives considered

- **Separate areas per mode** (Summary, Main): works without tabs, but the template grows an area per mode and
  pages can't tell which belongs where. Tabs keep one area per purpose.
- **Fields on pages** (sessions 44–45): removed; too much new structure.
- **Display modes on the page's own components**: every author would have to set them on every page.
- **All of it in the companion:** it would have to replace the merge, the validator and the canvas.

## Consequences

- Tapestry 0.7.0 (after 0.5.0 and 0.6.0). New unit tests (mode validation, merge per mode, slot keys), e2e steps
  (Shown in, tabs, foreign content) and a11y states (tabs).
- Template Management's body editor gains a "Preview as: Full | Teaser" switch later, if wanted (discussed; not
  in this step).

## Built (2026-10-23)

As decided, with these details settled while building:

- **Where the modes live:** in Tapestry's plugin data (`@nascencestudio/tapestry-display-modes`, only the added
  modes), switched on by `config.displayModes` when `@nascencestudio/tapestry-fabric` is installed (option
  `displayModes: false` turns it off). Fabric's page edits them through `@nascencestudio/tapestry/modes`
  (`loadModes`, `addMode`, `renameMode`, `deleteMode`, `loadModeUsage`, `listTemplateChoices`). So the editor,
  validator and renderer never load Fabric's code.
- **`modes` on nodes** is validated wherever it appears (unique keys, Full alone not stored) and only used in
  template bodies: a component copied from a template to a page keeps it harmlessly.
- **Tabs** are drawn by the canvas script on the area labels (`Area.astro` is unchanged); the server only picks
  each area's content from `tapestry-tabs`. Switching a tab clears a selection in the area's other tab, and
  click-to-add goes into the tab shown. Selecting a component in a mode's content switches its area's tab.
- **Lists' items** are rendered with `@nascencestudio/tapestry/Document.astro`; after each render the canvas
  strips editor markers inside `<tapestry-foreign>`.
- **For companions** (`@nascencestudio/tapestry/page`): `listPagesForLists()` (visible pages with categories,
  tags, template, published date, language group, published document), `pageInMode()`, `pageText()`, and
  `currentPageId()` (set by `getPage()`; the editor's render requests send `tapestry-page`). `nodesText()` from
  the main entry.
- **`select` with `multiple`:** chips with an autocompleting box (`ChipsField`, a native `<datalist>`); also
  used for "Shown in".
- **"Preview as"** (added 2026-10-30, the user's request): in the template editor's canvas bar, `All` (the
  default: everything, as before) or a mode. Components not shown in the mode are hidden on the canvas (the
  canvas script marks them; no re-render), except the selected one, which stays faded so a component just
  added (Full by default) can still be edited. Buttons for up to four modes, a dropdown beyond.
- **`withNodeId`** (added 2026-10-30, for the Page list's pager): a definition can ask for its node's id as a
  `nodeId` prop, stable per placement, e.g. to name its own URL parameter.
