# Drupal Canvas: what we're emulating

_Researched 2026-10-02._

[Drupal Canvas](https://www.drupal.org/project/canvas) (1.0 released
December 2025, formerly "Experience Builder") is Drupal's visual, component-based
page builder.

## What Canvas does

- **Drag-and-drop canvas**: drag components from a library onto the page
  preview; nested layouts through slots.
- **Component model**: Single Directory Components (SDC). Each component bundles
  its markup, styles, and behavior, and declares **props** (configurable values) and
  **slots** (nested content areas).
- **Code components**: developers (or power users) write JSX + CSS
  components in the browser. These run on **Preact** and can use Tailwind.
- **Editor UI**: a React application talking to Drupal's APIs.
- **Viewport switcher**: desktop, tablet, and mobile previews.
- **Dual-mode workflow**: developers build components; editors compose pages without code.
- **Real-time collaboration** and patterns (reusable sections) are part of the vision.

Sources:
[Perficient: Drupal Canvas 1.0](https://blogs.perficient.com/2025/12/15/the-visual-revolution-is-here-drupal-canvas-1-0),
[The DropTimes: Canvas 1.0](https://www.thedroptimes.com/node/64513),
[The DropTimes: Canvas vs Display Builder](https://www.thedroptimes.com/67467/drupal-canvas-vs-display-builder-page-layout-comparison).

## Feature map: Canvas → Tapestry

| Canvas feature | Tapestry equivalent | Phase |
| --- | --- | --- |
| SDC components with props/slots | Astro components + `defineComponent()` prop schema; default slot via `acceptsChildren` | 1 ✅ (named slots: 4) |
| Component library sidebar | Library panel grouped by `category`, searchable | 2 ✅ |
| Layers / tree view | Layer tree with drag to reorder and nest, keyboard moves | 2 ✅ |
| Props form | Generated from the prop schema, with inline validation | 2 ✅ |
| Drag onto the visual canvas | Real page in an iframe, live updates, drop placement by geometry | 3 ✅ |
| Viewport switcher | Desktop / Tablet / Mobile | 3 ✅ |
| Patterns | Reusable patterns / saved sections | 4 |
| Media in props | Image prop on StudioCMS storage | 4 |
| Code components (in-browser JSX) | Deliberately deferred: running editor-authored code is a large security surface. Developers write components in the repo. | Maybe later |
| React editor | **Preact** editor, ~22.5 KB gzipped (ADRs 0002, 0006) | 2 ✅ |
| Real-time collaboration | Not planned for now | Later |

## Where we differ on purpose

- **Rendering**: Canvas renders on Drupal (PHP/Twig for SDC). Tapestry
  renders Astro components on the server, with no client JS by default.
- **Editor framework**: Preact instead of React, for size.
- **Security posture**: no in-browser code execution for editors; strict
  schema validation of every stored page.
