# 0007. Pragmatic drag and drop for the editor

- Status: Accepted (resolves the open question in ADR 0002)
- Date: 2026-10-02

## Context

The layer tree needs reorder, move across parents, and "drop inside" for
container components, plus dragging new components in from the library. Phase 3
will add dropping onto a live preview in an iframe.

## Options measured (2026-10-02)

| Library | Size (min+gz, our imports) | Version | Provenance | Notes |
| --- | --- | --- | --- | --- |
| **`@atlaskit/pragmatic-drag-and-drop`** core + hitbox | **~7 KB** | 4.0.0 / 3.0.0 | ✗ | Framework-agnostic, built on native HTML5 DnD (works across iframes), used in Jira, Trello, and Confluence. Apache-2.0. Three small dependencies. |
| `@dnd-kit/dom` | ~35 KB | 0.5.0 (pre-1.0) | ✓ | Framework-agnostic core of the new dnd-kit (what Puck uses). Pointer-based; keyboard sensor built in. API still changing (0.4 → 0.5). |
| Custom on native DnD | 0 KB | n/a | n/a | Would re-implement Pragmatic's cross-browser fixes (drag previews, honey-pot fix, hitboxes). |

## Decision

Use **Pragmatic drag and drop** (`adapter/element-adapter`, `utils/combine`) with the
**list-item hitbox** (`reorder-before` / `reorder-after` / `combine`), which maps
directly onto "insert above / insert below / put inside".

Accessibility doesn't rely on simulated dragging. Every drag operation has a
keyboard equivalent (Alt+arrows to move, indent, outdent), plus buttons for
duplicate and delete, and moves are announced through an `aria-live` region.
This is the approach Atlassian recommends for Pragmatic.

## Supply-chain notes

Atlassian publishes from an internal monorepo **without npm provenance**. Mitigations:
the 3-day release-age gate, exact version pins, a tiny transitive tree
(`raf-schd`, `bind-event-listener`, `@babel/runtime`), and the `trustPolicy`
check, which would flag a future provenance downgrade (none exists today).
Revisit if Atlassian starts publishing with provenance, or if `@dnd-kit/dom`
reaches 1.0 and its size drops.

## Consequences

- Native DnD makes the Phase 3 iframe canvas straightforward.
- Native DnD on touch devices depends on browser support (iOS 15+ and modern
  Android are fine); the keyboard and button paths cover the rest.
- Import paths changed in 3.x/4.x (`/adapter/element-adapter`, `/utils/combine`,
  hitbox `/list-item/attach-instruction`). Older blog posts show the old paths.
