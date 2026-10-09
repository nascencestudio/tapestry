# 0012. Rich text: a `richtext` prop type, stored as JSON, edited with ProseMirror

- Status: Accepted
- Date: 2026-10-05

## Context

Editors wanted a formatting toolbar for body text, like Drupal's CKEditor or the
StudioCMS HTML editor, but "nothing too complex", and with a configurable
set of buttons (Drupal lets admins choose a text format's toolbar).

Constraints:
- Page content is untrusted input (security.md). Storing HTML would put a
  sanitizer on every page render.
- Public pages ship no JavaScript; the editor stays light and loads only in
  the dashboard.
- The user excludes libraries from Meta (so not Lexical).

## Decision

1. **A new prop type, `richtext`, with a per-prop `toolbar`.** Any component can
   use it. The toolbar is the button list *and* the allowlist:
   `bold, italic, underline, strike, link, bulletList, orderedList, blockquote,
   heading2, heading3, heading4`. Paragraphs and line breaks are always allowed.
   Default: bold, italic, link, bulleted list, numbered list. Set by developers in
   `defineComponent()`, so it's versioned with the code.
2. **Stored as a JSON tree, not HTML.** The shape is ProseMirror's `toJSON()` for
   our schema (`{ type: 'doc', content: [...] }`, text runs with `marks`), spec in
   [data-model.md](../data-model.md#rich-text). `cleanRichText()` (pure, shared by the
   server and the editor) cleans values against the toolbar: disallowed formatting
   is removed but the text kept (headings become paragraphs, lists and quotes are
   unwrapped), links must pass `isSafeUrl()`, unknown nodes are dropped, and
   values over the limits (20,000 characters of text, 2,000 nodes, depth 8) are
   rejected. Its output is byte-identical to ProseMirror's (key order included),
   because documents are compared as JSON strings (draft vs published).
3. **Rendering without HTML strings.** `toRenderTree()` turns a value into
   `{ tag, attrs, children }` nodes from a fixed tag list (`p h2 h3 h4 blockquote
   ul ol li br strong em u s a`), and `RichText.astro`
   (`@nascencestudio/tapestry/RichText.astro`) renders it recursively. Every text and
   the only attribute (`href`) go through Astro's escaping. No `set:html`.
4. **Editing with ProseMirror.** The schema is built per field from its toolbar
   (`editor/richtext-schema.ts`), so disallowed formatting can't be typed, pasted
   or dropped in; pasted links with unsafe schemes are refused by the schema's
   parse rules. The field (`editor/RichTextField.tsx`) has the toolbar
   (`aria-pressed` states), keyboard shortcuts (Ctrl/⌘+B/I/U, Ctrl/⌘+K for links,
   Shift+Enter for a line break, Ctrl/⌘+[ / ] to outdent or indent list items), an
   inline link form (validates the address; Enter doesn't submit the page), and
   ProseMirror's own undo while focused. Changes go to the store like any
   other prop edit, so the canvas, Tapestry's Undo, drafts and publishing work as before.
5. **Loaded on demand.** ProseMirror is about 67 KB gzipped, more than double
   the rest of the editor. The field is a separate chunk. It starts loading when
   the browser is idle after the editor opens, and only on sites whose components
   use `richtext`. The editor's first load stays about 35 KB gzipped. (Corrected
   2026-10-06: this said "about 24 KB", which counted only the main chunk and missed
   the ~11 KB shared chunk.)
6. **Backwards compatible.** A plain string in a `richtext` prop (e.g. after
   changing a prop from `textarea` to `richtext`) converts on read: blank lines
   separate paragraphs, single line breaks become line breaks. That's how the
   old Text component displayed text, so pages look the same. The playground's
   Text component now uses `richtext` (bold, italic, link, lists, H3).

## Revision (2026-10-06): more formatting

At the user's request: heading levels 1–6 in one "Paragraph / Heading" dropdown,
quote and strikethrough in the Text component, subscript, superscript, horizontal
line, and an alignment dropdown (left, center, right, justify).

- New toolbar entries `heading1`, `heading5`, `heading6` (with the existing
  `heading2`–`heading4`), `subscript`, `superscript`, `horizontalRule`, `alignLeft`,
  `alignCenter`, `alignRight`, `alignJustify`. Each is still its own allowlist entry
  (so admins can switch single levels or alignments off); the heading and alignment
  entries render as one dropdown each (native `<select>`, keyboard accessible).
- Stored format: `heading.attrs.level` 1–6; optional `attrs.textAlign` on paragraphs
  and headings (left out when unset); `{ type: 'horizontalRule' }`; `subscript` and
  `superscript` marks, which exclude each other (in the editor and the cleaner).
- Alignment renders as `style="text-align: …"` from four fixed values. A class would
  need site CSS; the obsolete `align` attribute was not an option. Strict CSPs need
  `style-src-attr 'unsafe-inline'` for alignment to show (security.md).
- ProseMirror writes unset attributes (`textAlign: null`); `stripDefaultAttrs()` removes
  them so stored and cleaned values stay byte-identical (and existing content without
  alignment is unchanged).
- Shortcuts: Ctrl/⌘+, and Ctrl/⌘+. (sub/superscript), Ctrl/⌘+Alt+0–6 (paragraph,
  headings). No alignment shortcuts (Ctrl+Shift+R would collide with the browser's reload).

## Revision (2026-10-06): icons only

The toolbar mixed letters, symbols and words ("Link", "• List", "Paragraph",
"Default alignment"). Now every control is an icon (with the name and shortcut as
its tooltip and accessible label):

- Line icons drawn for Tapestry as inline SVG (`editor/icons.tsx`, 16×16,
  `currentColor`; no icon library or font): link, bulleted and numbered list, quote,
  horizontal line, remove formatting, and the four alignments. Typographic buttons
  keep styled letters (B, I, U, S, X₂, X²), all the same size.
- The two dropdowns are **menu buttons** (WAI-ARIA menu button pattern) instead of
  native `<select>`s, because a select can't show an icon. Each button's icon shows
  the current state: the text style button shows `P` or `H1`–`H6` for the block at the
  cursor; the alignment button shows that block's alignment. The menu lists icon +
  name. Mouse use keeps the text's focus and selection; keyboard: Enter/Space/↓ opens
  on an item, arrows/Home/End move, Enter/Space picks, Escape closes (and Escape
  elsewhere in the toolbar returns to the text instead of deselecting the component).
  Menus open leftward when they'd run past the window's right edge.

## Dependency review

All from the ProseMirror project, maintained by Marijn Haverbeke (its author),
MIT licensed, no dependencies outside the project, no install scripts.
None publish provenance, and none ever have, so `trustPolicy: no-downgrade` has
nothing to compare against. Every version was past the 3-day release-age gate.

| Package | Version | Published |
| --- | --- | --- |
| prosemirror-model | 1.25.12 | 2026-09-21 |
| prosemirror-state | 1.4.4 | 2025-10-23 |
| prosemirror-view | 1.42.6 | 2026-09-25 |
| prosemirror-transform | 1.12.2 | 2026-09-25 |
| prosemirror-commands | 1.7.2 | 2026-08-05 |
| prosemirror-keymap | 1.2.3 | 2025-05-04 |
| prosemirror-history | 1.5.1 | 2026-09-29 |
| prosemirror-schema-list | 1.5.1 | 2025-03-04 |
| orderedmap, w3c-keyname, rope-sequence (transitive) | 2.1.1, 2.2.8, 1.3.4 | 2023 |

Size: about 67 KB gzipped for everything we import (measured with esbuild,
minified, gzip -9); the built field chunk is 67.0 KB gzipped. `pnpm audit`:
no advisories.

## Alternatives considered

- **Lexical.** Framework-agnostic core and smaller, but made by Meta (excluded by the user).
- **Tiptap.** Built on ProseMirror and adds convenience, but also more packages
  and a larger tree. ProseMirror's own API is enough for this toolbar.
- **Store sanitized HTML** (like StudioCMS's HTML editor). Every render would
  depend on a sanitizer's correctness, and editor/output drift is common
  (StudioCMS's HTML editor didn't save at all, known issue #20).
- **Markdown.** Simple to store, but editors want a toolbar, and Markdown allows
  raw HTML unless that's carefully disabled.
- **A hand-written `contenteditable` editor or `execCommand`-based minis.**
  Small, but `execCommand` is deprecated and inconsistent, and paste/undo/cursor
  handling is a long tail of bugs.
- **A separate "Formatted text" component.** Two near-identical components
  confuse editors; a prop type lets any component have rich text, with its own toolbar.
- **Admin-configurable toolbars in the dashboard.** Possible later (a plugin
  settings page could narrow the developer's list). Code config first.

## Consequences

- Components render rich text with one line: `<RichText value={body} />`.
- Editors get the same formatting rules in the editor, on paste, in the JSON
  view and on the public page, because everything goes through `cleanRichText()`.
- Changing a prop's toolbar later cleans existing content on the next render
  (formatting no longer allowed is removed, the text stays), with a warning in the editor.
- Inline editing directly on the canvas (roadmap) can reuse the same schema and field.
- Found while testing: Preact runs `useEffect` after paint, so syncing outside
  changes into the field in a passive effect could undo fast typing and move the
  cursor. The sync uses `useLayoutEffect` (runs before the next input event).
- e2e: a rich text suite (11 steps) covers the toolbar allowlist, typing and
  formatting, lists and headings, link validation, paste cleaning (scripts,
  event handlers, unsafe links), the canvas, undo sync, publish, and hostile JSON.
