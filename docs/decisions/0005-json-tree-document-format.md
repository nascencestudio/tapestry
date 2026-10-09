# 0005. Store pages as a validated JSON tree

- Status: Accepted
- Date: 2026-10-02

## Context

StudioCMS stores page content as a string. We need a format that a visual
editor can manipulate, that maps directly onto nested components, and that we
can validate strictly because editors are untrusted.

## Decision

Store a versioned JSON document: `{ version: 1, root: TapestryNode[] }`, where
each node is `{ id, type, props, children? }`. Validate against the component
manifest on every render and in the editor, using the same code. Validation
never throws; it returns a cleaned document plus issues.
Full spec: [data-model.md](../data-model.md).

## Alternatives considered

- **HTML with custom elements** (what the registry consumes natively): hard to
  edit structurally, ambiguous to validate, and has the entity-decoding problem (ADR 0004).
- **MDX/Markdown with components**: good for prose-first pages; poor for
  layout-first drag and drop; risky (MDX is executable).
- **Flat node map with parent pointers** (like some page builders): makes
  moves O(1), but nested arrays are simpler to validate and diff, and the
  editor can index the tree in memory when it needs to.

## Consequences

- Trivially diffable and inspectable; StudioCMS's diff view works on it.
- A `version` field allows migrations later.
- Clean separation: the editor only manipulates data; rendering is entirely server-side.
- Nested arrays mean moving a node rewrites two parent arrays. That's fine for
  the page sizes the limits allow (2,000 nodes).
