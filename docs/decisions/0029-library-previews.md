# 0029. Component thumbnails and live previews in the library

- Status: Accepted
- Date: 2026-10-07

## Context

The last Phase 4 item: "Component thumbnails/previews in the library". The
library lists components by label and description only; editors can't see what
a component looks like before adding it. Drupal Canvas shows a rendered preview
when hovering a component.

## Decision

1. **Live previews, no configuration.** Hovering (350 ms) or focusing a library
   item shows a popover with the component rendered with the values a new one
   starts with (`createNode()`), through the existing editors-only render
   endpoint (cached per type for the session; failures aren't cached).
   - It's shown in an `<iframe srcdoc>` with **`sandbox="allow-same-origin"`**
     (no scripts run; same origin only so the frame's height can be read),
     scaled from 960 px wide to 30%, at most 260 px tall.
   - Styles: the canvas page's stylesheets (`<link rel=stylesheet>` and
     `<style>` in its head, minus the canvas overlay's) and its `<html>`/`<body>`
     classes, so the preview looks like the site. Without a loaded canvas there's
     no preview (unstyled markup would mislead).
   - Markup only: page-level tags and editing drop zones are removed.
   - The popover is decorative (`aria-hidden`): the item's label and description
     already say what it is. It hides on leave, blur, click and drag start.
2. **Optional thumbnails.** `thumbnail: './src/…/hero.png'` on a definition
   (`.png`, `.jpg`, `.jpeg`, `.webp`, `.avif`, `.gif`, `.svg`), resolved like
   `component` and bundled by Vite (`virtual:tapestry/thumbnails`, `?url`
   imports). The path never reaches the manifest. The library shows it on the
   item (an icon beside the label in the wide layout) and, larger, as the hover
   preview instead of the live render: a designed picture says more than, for
   example, an empty layout.

## Alternatives considered

- **Screenshots generated at build time** (headless browser): heavy dependency,
  slow builds, stale when CSS changes.
- **Rendering previews into the canvas page** (offscreen): would disturb the
  canvas's own layout, overlay and inline editing.
- **Example props for previews** (`previewProps` on the definition): useful later;
  the starting values are what the editor actually gets when adding.

## Consequences

- One render request per component type per editor session, on first hover.
- SVG thumbnails are shown with `<img>` (scripts in SVG don't run there).
- Vite inlines small thumbnails (under 4 KB) into the editor bundle as `data:` URLs; a
  Content-Security-Policy on the dashboard would need `img-src data:` (the site sets none today).
- e2e suite `library` (4 steps).
