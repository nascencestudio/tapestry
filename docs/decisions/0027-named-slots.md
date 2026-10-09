# 0027. Named slots

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 4 lists "Named slots (e.g. a two-column layout with `left` and `right`)".
Until now a component could hold children only in its default `<slot />`
(`acceptsChildren`). Two facts constrain the design:

- StudioCMS's component registry renders each element with
  `jsx(Component, { ...attributes, 'set:html': children })` (verified in
  `@withstudiocms/component-registry` 0.2.x `createComponentProxy`): children
  reach `Node.astro` as **one HTML string in the default slot**. There is no
  way to pass named slots through it.
- Every tree walker (validator, renderer, diff, history, partial render, layer
  tree, canvas, clipboard) iterates `node.children`.

## Decision

1. **Definition:** `slots: { left: { label: 'Left column' }, … }` on a component
   (names follow the prop name rules, not `default`). `acceptsChildren` still
   adds the default area; a component can have both.
2. **Storage: the slot is a property of the child** (`slot: 'left'`), not a
   map of arrays on the parent. Children stay in one array, **grouped by area**
   (default first, then the slots in definition order, stable within each). The
   validator canonicalizes the grouping and key order (`id, type, label, slot,
   props, children`), and the editor's tree operations keep it (`sortByArea`).
   So every walker works unchanged; only placement code knows about slots.
3. **Validation:** a slot the parent doesn't have moves the child to the default
   area (warning) if there is one, else drops it (error); children without a slot
   under a slots-only component are dropped; `slot` on top-level nodes is
   ignored. Slot names are matched with `Object.hasOwn` and the name pattern, so
   `__proto__` and friends never match.
4. **Rendering:** the renderer wraps each named slot's children once in
   `<tapestry-slot name="…">` inside the parent's `<tapestry-node>` (allowed by
   the sanitizer, not a registry component). `Node.astro` splits the children
   HTML with `splitSlots()` (pure: only top-level, well-formed wrappers with a
   valid name count; anything else stays in the default area) and renders
   `<Component>` with `<Fragment slot={name} set:html={…} />` per filled slot,
   so components use ordinary `<slot name="left" />`. The wrappers can't be
   forged by content: child output has its own wrappers consumed already, and
   text and attribute values are HTML-escaped.
5. **Editor:**
   - Tree operations take a `slot` in their `Target`; inserting sets the
     child's slot; moving can change only the slot; keyboard moves cross into
     the neighbouring slot (Alt+↑ on the first item of "Right" → end of "Left");
     indent goes to the end of the previous sibling's last area; outdent keeps
     the parent's slot; paste and duplicate keep the selected node's slot.
   - Layer tree: a labelled group per area ("LEFT COLUMN") with its own end zone;
     rows say "in Left column" to screen readers.
   - Canvas: in canvas mode every area of a slot component is wrapped in a
     `display: contents` marker (`data-tapestry-slot-of`, `data-tapestry-slot`)
     and empty areas show a drop zone. Drop geometry finds the area under the
     pointer (the element the component put the slot in, e.g. the column) and
     the position among that slot's children; before/after a child keeps its
     slot, and only same-slot siblings decide stacked vs side by side.
   - A slot change is never a partial render; the change list reports it as a
     move, with the slot in the path ("Two columns › Right column").

## Alternatives considered

- **`slots: Record<string, TapestryNode[]>` on the parent** (as the data model
  originally planned, and close to Drupal Canvas): clearer in isolation, but every
  walker and tree operation would need a second kind of child list, and moves
  would need (parent, slot, index) addressing everywhere.
- **Rendering slot children inside `Node.astro` with `Astro.self`** (bypassing the
  registry for subtrees): would need the subtree in the props attribute
  (duplication, size) and a second render path.
- **A registry component for `<tapestry-slot>`** emitting comment markers: same
  splitting problem, plus comments must survive the sanitizer.

## Consequences

- Component authors write normal named slots; nothing Tapestry-specific.
- Text in slots of nested components is unaffected (inline editing finds
  elements by node marker, not by slot).
- Playground: a "Two columns" component (`left`, `right`). e2e suite `slots`
  (7 steps).
