# 0002. Use Preact (not React) for the editor UI

- Status: Accepted (drag-and-drop question resolved by [ADR 0007](0007-drag-and-drop-library.md); Puck evaluated in [ADR 0006](0006-build-our-own-editor-not-puck.md))
- Date: 2026-10-02

## Context

Drupal Canvas's editor is a React app; its in-browser "code components" run on
**Preact**. The user asked for something faster, lighter, and more secure than
React if possible.

The editor runs only in the authenticated dashboard, but it still benefits
from a small bundle (fast load on slow connections, less dependency surface).

## Decision

- Build the editor UI with **Preact 10.x** and **@preact/signals** for state.
- Mount it as an island inside `Editor.astro`; it is **never** loaded on public pages.
- Avoid `preact/compat` unless a specific library requires it, so we don't
  pull in React-ecosystem assumptions.
- Pin Preact to 10.x: `@astrojs/preact@6.0.5` declares `peerDependencies: { preact: "^10.6.5" }`,
  so Preact 11 isn't supported by the official Astro integration yet.

## Alternatives considered

| Option | Runtime size (min+gz, approx.) | Notes |
| --- | --- | --- |
| React 19 + ReactDOM | ~45–60 KB | What Canvas uses; largest ecosystem; heaviest |
| **Preact 10 + signals** | ~5 KB | React-like API, fine-grained reactivity, Canvas-compatible mental model |
| Solid | ~7 KB | Excellent performance; smaller ecosystem for editor UI pieces |
| Svelte 5 | small runtime, compiler | Different authoring model; Astro supports it well |
| Vanilla / Web Components | 0 KB | Most work for a complex stateful UI |

Preact gives the React-style component model (familiar to Canvas contributors
and most frontend developers) at a fraction of the size, with signals for
efficient updates in a large tree editor.

## Drag and drop (resolved: see ADR 0007)

Candidates for the Phase 2 spike:

- **Native HTML5 drag and drop plus pointer events**: zero dependencies; we
  must handle touch, keyboard, and auto-scroll ourselves.
- **`@atlaskit/pragmatic-drag-and-drop`**: framework-agnostic, small core,
  built on native DnD, works across iframes (useful for the Phase 3 canvas).
- **dnd-kit**: React-oriented; needs `preact/compat`. Least preferred.

Criteria: bundle size, accessibility (keyboard dragging, screen-reader
announcements), touch support, iframe support, maintenance and provenance.

## Consequences

- Editor bundle stays small; fewer dependencies to audit.
- Some React-only libraries won't be usable without `compat`; we accept that.
- Upgrade to Preact 11 when `@astrojs/preact` supports it.
