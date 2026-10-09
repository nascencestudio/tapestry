# 0013. Inline editing of rich text on the canvas

- Status: Accepted (revised 2026-10-06 after user feedback, see "Revision")
- Date: 2026-10-06

## Context

Rich text (ADR 0012) was editable only in the settings panel. Drupal Canvas
lets editors type directly on the page, and the canvas already shows the real
page (ADR 0010), so the obvious next step was to edit text in place.

Constraints:
- The canvas is server-rendered by the site's own components; the editor
  doesn't know which DOM came from which prop.
- The canvas re-renders on every document change (swapping the root's HTML),
  which would destroy whatever is being typed into.
- ProseMirror is 67 KB and loaded on demand; the canvas controller is in the
  editor's main chunk.

## Decision

1. **Markers from the server, canvas mode only.** `Node.astro` registers each
   object prop value (rich text) with its node id and prop name in a per-request
   `WeakMap` on `Astro.locals`. `RichText.astro` looks its `value` up and, if
   found, wraps its output in `<tapestry-canvas-text data-tapestry-text="nodeId"
   data-tapestry-prop="prop" style="display: contents">`. No component changes
   are needed. Public responses never contain the marker (e2e-checked).
2. **Starting an edit:** double-click any rich text on the canvas, click the
   text of the already-selected component, or press Enter with a component
   selected. The wrapper becomes a ProseMirror editor (`{ mount: wrapper }`,
   `display: block`, outlined) using the same schema, commands, shortcuts and
   link rules as the settings field (shared `editor/richtext-editor.tsx`).
   The caret goes where you clicked (`posAtCoords`).
3. **Toolbar in the canvas header.** While editing, the canvas panel shows
   "Editing: Body", the field's toolbar and a Done button. It lives in the
   dashboard document (not floating inside the iframe); focus moving into it,
   including the link form, doesn't end the edit.
4. **Store as the source of truth.** Each change is committed like a settings
   edit (`updateProps`, coalesced per field), so undo, the settings field,
   drafts and publishing all see it. Outside changes (undo, the settings field)
   sync into the inline editor; deleting or deselecting the node ends the edit.
5. **No re-render while editing.** The controller skips renders while an inline
   edit is active (no "pending" state either) and re-renders once when it ends
   (Escape, Done, clicking elsewhere, selecting another component).
6. **Stopping:** Escape (doesn't also deselect), Done, or focus leaving both
   the text and the inline toolbar.
7. **Dragging:** pressing on the text of the *selected* component (or text
   being edited) places the caret instead of starting a drag. Unselected
   components still drag from anywhere; selected ones drag by the chip handle.

ProseMirror runs in the dashboard window while its DOM lives in the iframe.
It handles this: selection is read through the editor's root document, and
nodes created in the dashboard document are adopted on insertion.

## Revision (2026-10-06): editable on selection, toolbar under the chip

The first version (points 2, 3, 5, 6 above) needed a second click or a
double-click to start editing, outlined the text a second time, and put the
toolbar in the canvas header. The user found the second click unintuitive and
the double outline unattractive. Now:

- **Selecting a component makes its rich text editable immediately**: from the
  canvas (the caret goes where you clicked) or from the page structure (the text
  becomes editable without taking focus, so keyboard navigation in the tree keeps working).
- **The toolbar sits directly under the selection chip** (drag handle, duplicate,
  delete), inside the canvas overlay. Chip and toolbar are placed above the
  component so they never cover its text; without room above they go below it, and
  for a component taller than the window they stick to the top. The toolbar has its
  natural width (`max-content`) and is kept inside the visible area.
- **One outline**: the selection outline only; the edited text has none.
- **The settings panel points to the canvas** ("Edit this text directly on the
  canvas") instead of showing the field, with an **Edit here instead** button for
  keyboard users or when the canvas can't edit that field. Fields the canvas can't
  edit (no marker) still show the panel editor.
- **Other changes no longer wait**: typing on the canvas doesn't trigger
  re-renders, but any other change (a setting, undo, a move) re-renders the canvas
  and editing resumes on the fresh markup with the same caret position.
- **Editing ends** on Escape (the component stays selected; click the text to
  continue), selecting something else, or deleting the component. Focus leaving
  the text no longer ends it.
- When editing ends, a static copy of the text stays in place until the re-render
  arrives (ProseMirror empties its element on destroy, which caused a flash).

## Alternatives considered

- **A floating toolbar inside the iframe.** Closer to CKEditor's balloon, but
  it means rendering Preact into another document, positioning against scroll
  and layout, and keeping site CSS from styling it. The header toolbar is
  stable and accessible; a floating one can come later.
- **Re-render around the edited element.** Swapping everything except the
  editor's subtree is fragile (component wrappers, layout). Pausing renders is simple and safe.
- **Ask components to mark their editable props** (e.g. `<Editable prop="body">`).
  More flexible, but every component author would need to do it. Identity
  lookup through `RichText.astro` works for all rich text with no changes.
- **contenteditable without ProseMirror.** Two editing engines with different
  rules for the same field would drift; sharing the field's core keeps paste
  cleaning and the toolbar allowlist identical.

## Consequences

- Plain `text` / `textarea` props are not inline-editable yet. They'd need a marker
  from the component, since the value is printed as a bare string.
- A component that copies or transforms a rich text value before passing it to
  `RichText` loses the marker, so its text is only editable in the settings panel.
- While editing, other changes (e.g. a select in the settings panel) show on the
  canvas only after the edit ends.
- The canvas layout must allow the wrapper to become `display: block` while
  editing (it replaces a `display: contents` box inside the component's own
  container); typical text components are unaffected.
- e2e: an inline editing suite (10 steps) covers double-click and click-to-edit,
  typing, the header toolbar and link form, remove formatting, Escape, ending on
  selection change, no canvas markers on public pages, and publishing.
