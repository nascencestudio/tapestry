# 0024. Inline editing of plain text props on the canvas

- Status: Accepted
- Date: 2026-10-07

## Context

Rich text props are editable directly on the canvas (ADR 0013) because
`RichText.astro` marks its output. Plain `text` props (headings, button labels)
weren't: components render them as `{heading}`, so nothing tells the canvas which
element shows which prop. The roadmap noted "needs a marker from components".

## Decision

- **Find the element instead of requiring a marker.** When a component is
  selected, each of its `text` props is matched, inside that component only (not
  inside nested components or rich text), to:
  1. an element marked `data-tapestry-text-prop="<prop>"` (optional, for markup
     that doesn't show the value as-is), else
  2. the one element without child elements whose text equals the value.
  No match, more than one, or two props on the same element: that prop stays in
  the settings panel only. Nothing is ever guessed.
- The element becomes `contenteditable="plaintext-only"` (`role="textbox"`,
  labelled); typing commits like the settings field (newlines removed, length
  capped at the prop's `maxLength`), without re-rendering; Enter or Escape
  finishes and the canvas re-renders. Pressing into the text places the caret
  instead of dragging the component.
- A re-render that happens while typing (e.g. one scheduled by the previous edit
  ending) keeps focus and the caret: the text is suspended before the swap and
  restored after (`suspend()`/`resume()`), like rich text.
- `textarea` props aren't edited on the canvas (multi-line rendering varies too much).

## Alternatives considered

- **A required `<EditableText>` component or `data-` marker in every component:**
  more reliable, but every component author has to remember it; the match covers
  the common cases with no work, and the marker remains for the rest.
- **Wrapping prop values in String objects in canvas mode** to track them through
  rendering: breaks components that compare or test strings (`{label && …}` is
  always true for an object).

## Consequences

- Works for the playground's Hero (heading, subheading, button label), Heading
  and Button without changes. Components that transform a value before showing it
  (e.g. adding a prefix) keep editing in the settings panel unless they add the marker.
- e2e: inline suite +1 step (match, type without re-render, caret kept across a
  re-render, Enter, undo, nested components not editable).
