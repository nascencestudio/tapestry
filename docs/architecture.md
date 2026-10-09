# Architecture

_Last updated: 2026-10-05 (Phase 3: visual canvas)._

## The big picture

Tapestry is a StudioCMS **plugin**. It doesn't replace StudioCMS's storage,
auth, or dashboard. It adds one **page type** (`tapestry/canvas`) whose content
is a JSON tree of components, plus an editor and a renderer for that page type.

```
 Developer                         Editor (dashboard)                Visitor
 ─────────                         ──────────────────                ───────
 Astro components                  Tapestry editor                   GET /some-page
 + defineComponent()               (Preact: library, layer tree,     │
        │                           ✓ Phase 2: Preact drag & drop)   ▼
        ▼                                  │                  [...slug].astro
 studiocms.config.mjs                      │ writes JSON to          │ StudioCMSRenderer
   tapestry({ components })                ▼ <textarea name=          ▼
   componentRegistry:              "page-content">            StudioCMS looks up the
     tapestryComponentRegistry()           │                  renderer by page type
        │                                  ▼                         │
        ▼                          StudioCMS saves the               ▼
 build time: virtual modules       page content string        Tapestry renderer
   virtual:tapestry/manifest       (database)                 parse → validate → HTML
   virtual:tapestry/components                                       │
                                                                     ▼
                                                              StudioCMS sanitizes HTML,
                                                              component registry swaps
                                                              <tapestry-node> → Node.astro
                                                                     │
                                                                     ▼
                                                              Node.astro renders the real
                                                              Astro component (SSR)
```

## Components of the system

### 1. Component definitions (developer-facing)

`defineComponent()` ([`define.ts`](../src/define.ts))
declares a component: its `type` (kebab-case id), label, the `.astro` file,
the props an editor may set (typed schema), and whether it accepts children.
Definitions are validated when the config loads, so mistakes fail at startup.

`toManifest()` strips file paths to produce the **manifest**: the
browser-safe description of all components that the validator, renderer,
and editor share.

### 2. The plugin ([`index.ts`](../src/index.ts))

`tapestry({ components })` returns a StudioCMS plugin that:

- **`studiocms:astro-config`** adds an Astro integration whose
  `astro:config:setup` injects the `/_tapestry/render` route, pre-bundles the
  editor's browser dependencies in dev (`optimizeDeps.include`, so the first editor
  visit doesn't trigger a Vite reload), and registers a Vite plugin ([`vite.ts`](../src/vite.ts))
  serving two virtual modules:
  - `virtual:tapestry/manifest`: the manifest as JSON.
  - `virtual:tapestry/components`: static imports of every registered
    `.astro` file, keyed by type. Static imports let Vite bundle and
    tree-shake normally; nothing is resolved dynamically at runtime.
- **`studiocms:rendering`** registers page type `tapestry/canvas` with:
  - `rendererComponent`: [`runtime/renderer.ts`](../src/runtime/renderer.ts)
  - `pageContentComponent`: [`runtime/Editor.astro`](../src/runtime/Editor.astro)

`tapestryComponentRegistry()` returns the one `componentRegistry` entry
users must add (StudioCMS plugins can't add registry entries themselves):
`{ 'tapestry-node': '<path>/runtime/Node.astro' }`.

### 3. Validation ([`validate.ts`](../src/validate.ts))

`parseDocument(content, manifest)` / `validateDocument(value, manifest)`:

- Never throw. They return a **cleaned document** (invalid nodes and props
  dropped, defaults filled in) plus a list of issues with JSON paths.
- Enforce hard limits: 1 MB of content, depth 32, 2,000 nodes, per-prop
  length limits.
- Check every prop against its schema; `url` props allow only relative URLs or
  `http`, `https`, `mailto`, `tel`.
- Reject unknown component types (using own-property checks, so names like
  `constructor` can't slip through) and duplicate or malformed node ids.

The same validator runs on the server (rendering) and in the browser (the
editor's live feedback), so editors see exactly what the renderer will accept.

### 4. Rendering ([`render.ts`](../src/render.ts), [`runtime/`](../src/runtime))

StudioCMS's renderer contract is `renderer(content: string) => Promise<string>`
(HTML). It cannot render Astro components itself, but StudioCMS then runs the
HTML through its **component registry**, which replaces registered custom
elements with Astro components on the server. Tapestry uses that mechanism with
a single wrapper element (see [ADR 0004](decisions/0004-single-wrapper-element.md)):

1. `renderDocument()` wraps the document in `<tapestry-root>` and turns each node into
   `<tapestry-node id="hero-1" type="hero" props="%7B%22heading%22%3A%22Hi%22%7D">…children…</tapestry-node>`.
   Props are JSON, then `encodeURIComponent`, so the value contains no
   characters that need HTML escaping and survives StudioCMS's HTML pipeline
   byte-for-byte. Children in a named slot are wrapped once per slot in
   `<tapestry-slot name="…">` (ADR 0027).
2. StudioCMS sanitizes the HTML with our `sanitizeOptions` (only
   `tapestry-root`, `tapestry-node` and `tapestry-slot` are allowed) and swaps the first two for `Root.astro`
   (adds nothing outside canvas mode) and `Node.astro`,
   passing already-rendered children as the default slot.
3. `Node.astro` decodes the props, looks up the component in
   `virtual:tapestry/components`, and renders it, with children in its
   default `<slot />`, and each `<tapestry-slot>` wrapper's content (taken apart
   with `splitSlots()`) in the matching named slot.

Result: plain server-rendered HTML from your own Astro components. Props keep
their JSON types (numbers stay numbers, booleans stay booleans).

The stored content is a **stored page** (published version, draft, history;
[data-model.md](data-model.md#stored-page-format-2)). The renderer only ever renders
`published`. `getPage()` hands the renderer the draft instead when an editor
previews or uses the canvas (on a copy of StudioCMS's cached page object).

### 5. Editing ([`runtime/Editor.astro`](../src/runtime/Editor.astro), [`editor/`](../src/editor))

StudioCMS renders the page type's editor inside its page edit form (on the
**Page Content** tab) and saves whatever is in `<textarea name="page-content">`.

`Editor.astro` renders that textarea plus a host element, then a bundled script
calls `mountEditor()` ([`mount.tsx`](../src/editor/mount.tsx)),
which hides the textarea and renders the Preact app. Without JavaScript, the
textarea stays visible as a plain JSON editor.

```
mount.tsx ── parseStoredPage(content) ── workingDocument() ──► store.ts (signals)
                                                 doc · selectedId · history
                                                 │ commit(newDoc, {select, coalesceKey})
     ┌───────────────┬───────────────┬───────────┴────┬──────────────┐
 Library.tsx     Layers.tsx      PropsPanel.tsx    JsonView.tsx     App.tsx
 click / drag    tree, DnD,      fields from       raw JSON,        toolbar,
 to add          keyboard        prop schema       validated apply  undo/redo
     └────── dnd.ts (Pragmatic DnD: drag sources, drop targets, monitor) ──┘
                                                 │ effect: doc changed?
                                                 ▼
                publishing.ts: saveDraft() / publish() (revisions.ts, pure)
                                                 ▼
          textarea[name=page-content].value = stored page JSON  → StudioCMS Save
```

**Publishing** ([ADR 0011](decisions/0011-draft-publish-history.md)):
[`publishing.ts`](../src/editor/publishing.ts) keeps the stored
page in a signal and, after the first edit, writes `saveDraft(stored, doc)` into the
textarea on every change. **Save draft** (or StudioCMS's Save) submits that.
**Publish** writes `publish(stored, { doc, now, by })` and submits the form.
**Restore** / **Discard** commit a history entry or the published document to the
store as normal undoable edits. [`HistoryPanel.tsx`](../src/editor/HistoryPanel.tsx)
lists the live version and up to `historyLimit` earlier ones.

Key properties:

- **One source of truth.** The document lives in a signal. Every edit is a pure,
  immutable tree operation ([`tree.ts`](../src/editor/tree.ts))
  passed to `commit()`, which records undo history (100 steps; keystrokes in the
  same field within 1 s merge into one step). Rejected operations (e.g. a
  container into its own child) return `null` and change nothing.
- **Opening never rewrites content.** The textarea is written only after the
  first real edit, so viewing a page can't silently clean or reformat what's stored.
  Unreadable content (invalid JSON or an unknown version) opens in the JSON view,
  and nothing is overwritten until valid JSON is applied.
- **Same validator everywhere.** The toolbar's status, per-field errors, and
  JSON apply all use `validate.ts`, the same code the renderer uses.
- **Form-safe.** Editor controls have no `name` attributes (StudioCMS would save
  unknown named fields as plugin data), every button is `type="button"`, and
  Enter in single-line inputs is suppressed so it can't submit (save) the page.
- **Accessible.** ARIA tree pattern with roving focus; every drag has a keyboard
  equivalent (Alt+arrows move, indent, outdent; Delete; Ctrl/⌘+D; Ctrl/⌘+Z);
  changes are announced through an `aria-live` region.
- **Client-side navigation safe.** The script mounts on load and on
  `astro:page-load`, guards against double mounting, and unmounts on `astro:before-swap`.
- **Themed by StudioCMS.** [`editor.css`](../src/editor/editor.css)
  uses the dashboard's CSS variables (light and dark) and container queries, so the
  layout adapts to the editor's own width (three columns, or library on top, or stacked).

Production bundle (gzip -9, dashboard only): about **35 KB** on first load (main chunk
22.5 KB + a shared chunk with the validator and rich text helpers 11.4 KB + ~1 KB runtime),
plus the rich text field (ProseMirror, about **67 KB gzipped**) in its own chunk,
loaded when the browser is idle after the editor opens, and only if a component uses `richtext`.

**Rich text** ([ADR 0012](decisions/0012-rich-text.md)): `richtext` props are edited by
[`RichTextField.tsx`](../src/editor/RichTextField.tsx), a ProseMirror
editor whose schema ([`richtext-schema.ts`](../src/editor/richtext-schema.ts))
is built from the prop's `toolbar`. Each change is reported as a prop edit (so the
canvas, undo and publishing work unchanged). Outside changes (undo, restore, JSON) sync
into the field in a layout effect. Values are JSON (ProseMirror's `toJSON()` shape),
cleaned by [`richtext.ts`](../src/richtext.ts) on the server and in
the editor, and rendered by `RichText.astro` from an allowlisted element tree.

**Inline canvas editing** ([ADR 0013](decisions/0013-inline-canvas-editing.md)): in canvas
mode `Node.astro` registers rich text values with their node and prop
(`registerPropOwner()`), and `RichText.astro` wraps them in
`<tapestry-canvas-text data-tapestry-text data-tapestry-prop>`.
[`canvas/inline.ts`](../src/editor/canvas/inline.ts) turns a wrapper into a
ProseMirror editor (shared core: [`richtext-editor.tsx`](../src/editor/richtext-editor.tsx)),
commits edits to the store, and the controller pauses canvas renders until editing stops.
Selecting a component makes its rich text editable; the toolbar renders inside the
canvas overlay under the selection chip. Typing doesn't re-render the canvas; other changes
do, and editing resumes on the fresh markup (`suspend()`/`resume()`). The settings panel shows
a pointer instead of the field for text the canvas can edit (`canvasTextTargets`).

**Admin toolbar settings** ([ADR 0014](decisions/0014-admin-toolbar-settings.md)):
`TapestrySettings.astro` (Plugins → Tapestry, StudioCMS's dashboard layout, injected at the
URL StudioCMS links plugins to) → `ToolbarSettings.astro` (the form) → `POST /_tapestry/settings`
(`settings-endpoint.ts`) → `StudioCMSPluginData` via `toolbar-store.ts`. `Editor.astro`
loads the settings and mounts the editor with `applyToolbarSettings(manifest, settings)`.

### 6. Visual canvas ([`editor/canvas/`](../src/editor/canvas), [`runtime/Render.astro`](../src/runtime/Render.astro), [`runtime/canvas-mode.ts`](../src/runtime/canvas-mode.ts))

The editor's canvas is the **real page** in an iframe, kept in sync with unsaved
edits ([ADR 0010](decisions/0010-visual-canvas.md)):

```
Editor (dashboard)                                   iframe: /slug?tapestry-canvas
──────────────────                                   ─────────────────────────────
store.doc changes ──(debounce 120 ms)──► POST /_tapestry/render   getPage(): editor + param
                                          editors only, same-origin   → canvas mode (Astro.locals)
                                          → StudioCMSRenderer          → Root/Node emit markers:
                                            (canvas mode)                <tapestry-canvas-root data-tapestry-root>
                     ◄── HTML fragment ───                                <tapestry-canvas-node data-tapestry-node=id>
swap [data-tapestry-root] children (strip <style>/<link>/<script>) ──►     (display: contents)
controller.ts: overlay (hover, selection, chip), click → select, native DnD → geometry.ts → applyDrop()
```

- Markers exist only in canvas mode, which only editors can switch on.
  `Render.astro` checks the session, `Origin`, method and size.
- `geometry.ts` (pure) decides drop positions: inside a container (insertion
  index by reading order), before/after a leaf (left/right if siblings sit side by
  side), page end if nothing is under the pointer; cycles are refused.
- Drags from the dashboard (library, layers) reach the iframe as native drag
  events; a shared `activeDrag` signal says what's being dragged. Drags that
  start in the canvas use the chip's native drag handle.
- Layout: canvas centre (library + layers left, settings right) when the editor
  is ≥ 72rem wide, canvas on top otherwise; full-screen mode; Desktop/Tablet/Mobile widths.

### 7. Site integration ([`runtime/page.ts`](../src/runtime/page.ts), [`runtime/AdminBar.astro`](../src/runtime/AdminBar.astro), [`access.ts`](../src/access.ts))

Helpers for the **site's own** page routes, usable with any StudioCMS page type:

```
[...slug].astro ── getPage(Astro) ──┬─ SDK GET.page.bySlug(slug)
                                    ├─ getViewer(): StudioCMS User.getUserData()
                                    └─ pageAccess(page, viewer)  (pure, unit-tested)
                                         draft & not editor → null → 404
                                         editor → Cache-Control: private, no-store
                                         draft  → X-Robots-Tag: noindex
                                    └─ Tapestry pages: documentFor(stored, viewer, ?tapestry-preview)
                                         visitor → published (never published → null → 404)
                                         editor  → published, or the draft when previewing
Layout ── <AdminBar viewer page publishing/>  → renders (markup + inline CSS) only for editors
```

**JSON redaction** ([`runtime/middleware.ts`](../src/runtime/middleware.ts),
[`public-content.ts`](../src/public-content.ts)): a plugin-added
Astro middleware (order `pre`) checks every JSON response. If it could contain
Tapestry content and the viewer isn't an editor, stored `content` values are
replaced with the published document and never-published pages are removed.
This closes StudioCMS's anonymous REST API (`/studiocms_api/rest/v1/public/pages`),
which returns stored content verbatim.

The Tapestry editor's toolbar links back with **View page ↗**, built from the slug
field and the `pageUrlPattern` option (exposed via `virtual:tapestry/config`).
Guide: [admin-bar.md](admin-bar.md).

### 8. Media library ([`packages/medialibrary`](https://github.com/nascencestudio/medialibrary), [ADR 0016](decisions/0016-media-library.md))

A separate StudioCMS plugin. Server: `detect.ts` (type from bytes), `dimensions.ts`,
`svg.ts` (allowlist sanitizer), `remote.ts` (YouTube/Vimeo), `runtime/db.ts` (Kysely,
table created on first use), `runtime/storage.ts` (streamed uploads, local disk),
`runtime/api/*` (editors-only JSON API), `runtime/files.ts` (public files with ranges
and a sandbox CSP), `runtime/server.ts` (lookups for other plugins), `Media.astro`.
Editing extras ([ADR 0019](decisions/0019-media-editing-extras.md)): `meta.ts` (tags,
focal point), `subtitles.ts` (WebVTT/SRT cleaning), `stored.ts` + `keys.ts` (JSON columns,
storage keys), `responsive.ts` + `runtime/images.ts` (resized copies with sharp, loaded at
runtime from the package's install location), `runtime/receive.ts` (upload checks shared
by upload and replace), `api/file.ts`, `api/tracks*.ts`, `api/tags.ts`. Admin settings
(ADR 0018): `settings.ts`, `runtime/settings-store.ts`, `SettingsPage.astro`.
Browser: `ui/Library.tsx` (the Media page and the picker), `ui/details.tsx` (tag, focal
point and caption editors), `ui/picker.tsx`.

Tapestry finds the library at build time (`findMediaLibrary()` in `index.ts`) and
generates `virtual:tapestry/media` (server: `getMediaItems`, `Media`) and
`virtual:tapestry/media-client` (the lazy picker), or stand-ins without it.
`Node.astro` turns `media` prop ids into items; `RichText.astro` renders media blocks
with `Media`; the editor's media field and the rich text "Insert media" button open the picker.

## Where things run

| Code | Runs in | Ships to visitors? |
| --- | --- | --- |
| `define.ts`, `index.ts`, `vite.ts` | Node, at config/build time | No |
| `validate.ts`, `render.ts`, `renderer.ts` | Server, per request | No |
| `Node.astro` + your components | Server, per request | Only their HTML/CSS |
| `Editor.astro` + `editor/` (Preact app) | Dashboard browser (authenticated) | No |
| `access.ts`, `runtime/page.ts`, `runtime/viewer.ts` | Server, per public request | No |
| `revisions.ts` | Server and dashboard browser | No |
| `runtime/middleware.ts` + `public-content.ts` | Server, every request (work only on JSON bodies) | No |
| `AdminBar.astro` | Server, per public request | Only to logged-in editors (HTML + inline CSS, no JS) |
| `Render.astro` (`/_tapestry/render`) | Server, per canvas update | No (editors only) |
| `Root.astro` / canvas markers | Server | Markers only in canvas mode (editors) |

## Planned architecture (Phase 4+)

- **Interactive components (Phase 5)**: components that need client JS
  declare a hydration strategy; everything else stays static.
