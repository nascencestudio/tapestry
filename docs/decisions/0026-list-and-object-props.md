# 0026. List (repeater) and object props

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 4 lists "List/repeater and object props". Components like an FAQ, a card
grid or a logo strip need a variable number of entries with the same fields;
others need a few fields edited together (a call to action: text + link).
Until now every prop held one value, so developers had to fake repeaters with
child components.

## Decision

1. **Two prop types**, both built from the existing single-value types
   (`FieldDefinition`: text, textarea, url, number, boolean, select, richtext,
   media, link):
   - `object`: `{ type: 'object', label, fields }`. Stored as an object with the
     fields' values (definition order). No field set → no value.
   - `list`: `{ type: 'list', label, fields, minItems?, maxItems?, itemLabel? }`.
     Stored as an array of such objects. **Items are always objects**, even with
     one field: one storage shape, and "missing" values are simply absent keys
     (a list of bare values would need placeholders for unset items).
2. **One level of nesting only:** fields can't be objects or lists. That covers
   the common cases and keeps the editor, the validator and the cost bounded.
3. **Validation reuses the prop rules** (`cleanSlot`/`cleanValue` in
   `validate.ts`, now shared by props, object fields and list items):
   - each field is cleaned like a prop (defaults filled, required enforced,
     rich text cleaned, links canonicalized); issues carry paths like
     `root[0].props.items[2].question`;
   - an invalid list item (a required field missing or invalid) is dropped, not
     the whole node; a blank item (nothing filled in) is removed with a warning;
   - at most `maxItems` items (default 50, hard limit 100); fewer than
     `minItems` makes the list invalid; an empty list is no value;
   - unknown fields are ignored with a warning;
   - `defineComponent()` checks field names (same rules as props), field
     definitions, `minItems`/`maxItems` and defaults.
4. **Rendering:** `collectRefs()` (pure, `resolve.ts`) finds `media` and `link`
   values at any level, so `Node.astro` resolves them in one batch, as for
   top-level props. Containers are copied, never mutated.
5. **Editor** (`StructuredFields.tsx`): an object is a labelled group of the
   ordinary fields; a list shows items as collapsible rows titled by their first
   text ("Question 2" otherwise), with move up/down, remove and "Add
   {itemLabel}". Adding, moving and removing are single undo steps; typing in a
   field coalesces per field. Focus follows moved items and lands in a new
   item's first field; changes are announced. Nested element ids use `__` so a
   field named `label` can't collide with the group's own `-label` element (an
   actual bug caught by the e2e suite).
6. Not editable on the canvas: text inside list items and objects is edited in
   the settings panel (top-level `text` and `richtext` props still edit in place).

## Alternatives considered

- **Child components as repeaters** (what Drupal Canvas mostly does): fine for
  layout, but heavy for data like FAQ entries: every entry becomes a node in the
  page structure and needs its own component.
- **Arbitrary nesting** (lists of objects with lists): rarely needed, much more
  complex UI; can be added later without changing stored data.
- **Ids on list items:** would make keyed rendering and future per-item canvas
  editing easier, but adds stored noise; position works for the panel.

## Consequences

- `PropValue` now includes `ObjectValue` and `ObjectValue[]`; code that inspects
  values without their definition must not mistake an object for a link or rich
  text (the change list now uses the definition).
- Playground: an FAQ component (list of questions with rich text answers, an
  object "More help" link). It's not in the demo page, so other suites are
  unaffected.
- e2e suite `lists` (9 steps).
