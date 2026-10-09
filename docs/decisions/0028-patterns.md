# 0028. Patterns (saved sections)

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 4 lists "Reusable patterns / saved sections". Editors rebuild the same
arrangements (a pricing section, a call-to-action band) on many pages. Drupal
Canvas distinguishes **patterns** (a saved composition inserted as an
independent copy) from linked reuse (global regions or shared components, where
one edit updates every page). Linked reuse needs render-time resolution, cycle
checks, cache invalidation across pages, and answers about drafts and
publishing; copies need none of that.

## Decision

1. **Patterns are copies.** Saving stores the selected component with
   everything inside it (validated). Inserting fetches the pattern and inserts a
   fresh copy with new ids, cleaned against the current manifest like clipboard
   content. Later changes to a page don't touch the pattern, and deleting a
   pattern doesn't touch pages.
2. **Storage:** one row per pattern in StudioCMS's plugin data table
   (`@nascencestudio/tapestry-pattern:<id>`, through the SDK's database client
   like the toolbar settings; `usePluginData()` can't save, known issue #25).
   Pattern: `{ id: 'pt_' + 16 base-36, name, nodes, createdAt, createdBy,
   createdByName }`. Limits: 100 patterns, 100,000 characters each, names follow
   the node-name rules (≤ 60 characters, control and bidi-override characters
   removed).
3. **API** `/_tapestry/patterns` (editors only, `private, no-store`):
   GET lists names and descriptions (not the components, so the library stays
   light), GET `?id=` returns one pattern's components, POST `{ name, nodes }`
   saves, DELETE `?id=` removes. Writes are same-origin only and size-limited.
   **Delete** is for the pattern's author or an admin; any editor can save and use
   patterns (a pattern can't change a live page: inserting goes into the draft).
4. **Editor:** "Save as pattern…" in the settings panel (name defaults to the
   node's name or component label). The library lists patterns under
   "Patterns" (searchable): click inserts at the usual insertion point, drag works
   like a component (tree and canvas; a new `pattern` drag type, fetched then
   inserted). Delete has an inline confirmation.

## Alternatives considered

- **Linked patterns** (a node referencing a shared subtree, as the data model
  first planned): the powerful version, left for later. It can be added as a new
  node kind without changing copies.
- **Patterns in code** (developers define them in the config): good for
  starter layouts but editors can't create their own; could be added as
  read-only entries in the same library section.
- **A separate StudioCMS table:** needs a migration; the plugin data table already
  exists and holds JSON per row.

## Consequences

- Patterns made with components that were later removed lose those components
  when inserted (like clipboard content); a pattern with nothing left is hidden.
- `cleanNodeLabel()` now also strips bidi embedding, override and isolate
  controls (names are shown to other editors).
- e2e suite `patterns` (6 steps).
