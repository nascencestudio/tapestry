# 0006. Build our own Preact editor instead of using Puck

- Status: Accepted
- Date: 2026-10-02

## Context

[Puck](https://puckeditor.com) (`@puckeditor/core`, MIT) is a mature open-source
visual editor with drag and drop, a component library, an outline view, field
forms, and a JSON data model much like ours. Adopting it could save a lot of
Phase 2 work, so we measured it before writing any editor code.

## Findings (measured 2026-10-02, Puck 0.23.0)

| Question | Finding |
| --- | --- |
| Framework | Requires **React 18/19** (`peerDependencies.react`). Components render as React components inside Puck's canvas. |
| Bundle size | Minimal `<Puck>` app, minified: **1.2 MB JS, 367 KB gzipped** (+ 13.5 KB gzipped CSS). |
| On Preact? | Aliasing React to `preact/compat` still gives **303 KB gzipped**: React is a small part of the weight (Tiptap, Radix, dnd-kit, Zustand…). Running on compat is unsupported upstream. |
| Dependencies | 115 packages installed, including Tiptap (14 packages), Radix, `happy-dom`, and pre-1.0 `@dnd-kit/*` pinned to exact versions. |
| Provenance | **No Puck release has npm provenance** (0.21–0.23 checked). |
| Fit with Astro | Puck's canvas renders components with React. Ours are server-only Astro components, so the canvas would have to show server-rendered HTML in place of each component, and Puck's nested drop zones can't live inside that HTML. That removes Puck's main advantage (drag into nested slots on the canvas). |

For comparison, the editor we built (Preact + signals + Pragmatic drag and drop +
validator + UI) is **22.5 KB gzipped** in the production build.

## Decision

Build Tapestry's editor ourselves in Preact (ADR 0002), borrowing Puck's proven
UX patterns rather than its code:

- component library grouped by category, with search
- an outline (layer tree) with drag to reorder and nest
- a fields panel generated from each component's prop schema
- undo/redo history, and a JSON escape hatch

## Alternatives considered

- **Puck as-is (React in the dashboard):** about 16× heavier, React-only, no
  provenance, and an architectural mismatch with server-rendered Astro components.
- **Puck via `preact/compat`:** still about 300 KB gzipped, and an unsupported configuration.
- **Fork Puck:** we'd inherit a large React codebase to maintain.

## Consequences

- We own more UI code (about 1,300 lines for the Phase 2 editor). The tree and history logic has unit tests; the UI has browser e2e tests.
- The bundle stays small, and the dependency surface stays auditable.
- The data models are similar enough that a Puck JSON import/export could be
  added later if anyone needs to migrate.
