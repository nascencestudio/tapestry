# 0010. Visual canvas: the real page in an iframe, updated live

- Status: Accepted
- Date: 2026-10-05

## Context

The goal from day one was a Drupal Canvas-style editor where the editing surface
*looks exactly like the public page*. Phase 2 delivered the structure (library,
layer tree, settings), but editors still had to imagine the result.

Constraints:
- Components are server-only Astro components; the browser can't render them.
- The page's look depends on the site's own layout and CSS, not just the components.
- Public pages must stay free of editor code and markers.

## Decision

1. **The canvas is the page itself.** The editor shows an iframe of the page's
   public URL with `?tapestry-canvas`. `getPage()` turns on **canvas mode** for
   editors only (a per-request flag in `Astro.locals`), so the iframe renders
   through the site's real route, layout, CSS and components.
2. **Canvas-mode markers.** In canvas mode, `Root.astro` wraps the document in
   `<tapestry-canvas-root data-tapestry-root>` and `Node.astro` wraps each node in
   `<tapestry-canvas-node data-tapestry-node="id">`, both `display: contents`, so
   layout isn't affected. Public responses never contain them.
3. **Live updates without reloads.** On each edit (debounced 120 ms), the editor
   POSTs the unsaved document to **`/_tapestry/render`** (injected route,
   editors only, same-origin only, size-limited). It renders through the exact
   public pipeline in canvas mode. The editor swaps the iframe's root contents,
   with stale requests aborted, and strips page-level `<style>/<link>/<script>`
   (the iframe already has the site's CSS).
4. **Interaction layer** (`editor/canvas/controller.ts`, injected into the
   same-origin iframe): hover and selection outlines, a selection chip (drag
   handle, duplicate, delete), click-to-select with navigation blocked, keyboard
   shortcuts, and native drag and drop. **Components can be dragged directly on
   the page** (added 2026-10-05): pressing a component makes its top element
   draggable; if the press is inside the selected component, that one moves (so a
   selected container can be dragged from anywhere inside it), otherwise the
   innermost component under the pointer. Links and images drag their component,
   never themselves. Components show a grab cursor. Drop positions come from a pure geometry
   module (`geometry.ts`, unit-tested): inside containers, before/after leaves,
   left/right for side-by-side layouts, with cycles refused.
5. **Workspace.** Canvas in the middle (library + layers left, settings right) when
   there's room, otherwise on top. Viewport switcher (Desktop / Tablet 768 px /
   Mobile 390 px). Full-screen mode with its own Save (submits StudioCMS's form),
   plus Ctrl/⌘+S.

## Alternatives considered

- **Render HTML into the editor document (no iframe).** Site CSS would clash with
  the dashboard's, and viewport sizes and media queries can't be simulated.
- **Reload the iframe on every change.** Simple, but it flashes, loses scroll
  position, and re-runs the whole page: slow for typing.
- **A dedicated preview route with a configured layout.** Needs extra
  configuration and drifts from the real route; using the real URL guarantees
  fidelity.
- **Comment markers instead of wrapper elements.** Zero layout impact, but
  hit-testing and lookup get much harder. `display: contents` wrappers are queryable
  and `closest()`-friendly; their caveat is noted below.
- **Pragmatic DnD inside the iframe.** Its adapters bind to one window; native
  events in the iframe plus a shared "what's being dragged" signal are simpler
  and work for drags that start in the dashboard and end in the canvas.

## Consequences

- WYSIWYG fidelity: the canvas uses the site's real layout and CSS (e2e compares
  text and computed styles with the public page).
- **Requirements:** the site's route must use `getPage()` (otherwise the canvas
  says so), and the dashboard must be able to frame the site (same origin; don't
  send `X-Frame-Options: DENY` or `frame-ancestors 'none'` to editors).
- **Limitations:**
  - Components' client-side scripts don't re-run after a live swap (innerHTML
    import). Static components are unaffected; islands come in Phase 5.
  - CSS that targets direct children (e.g. `.grid > *:first-child`) sees the
    wrapper elements in the canvas only. `display: contents` keeps flex/grid
    layout intact, but structural selectors can differ.
  - Each edit costs one server render (debounced); fine for typical page sizes.
- Editor bundle: 22.5 → 27.2 KB gzipped.
- **Never touch the drag source during `dragstart`.** Changing its styles (even
  `pointer-events`) or hiding it later makes Chrome abort the drag (`dragstart` →
  `dragend` 1 ms later). Visual changes are deferred, and the chip stays rendered
  while it's being dragged. This was a real bug: chip dragging didn't work at all.
- e2e: Chrome's CDP drag interception doesn't cover drags that *start* inside an
  iframe, but genuine mouse input without interception does run a real drag there.
  The canvas suite uses real mouse drags (`page.realDrag()`) for chip, direct and
  link drags.
