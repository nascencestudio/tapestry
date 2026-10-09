# Data model

_Normative specification for the Tapestry **document** (format 1) and the
**stored page** that wraps it (format 2)._
_Source of truth in code: [`types.ts`](../src/types.ts), [`validate.ts`](../src/validate.ts) and [`revisions.ts`](../src/revisions.ts)._

## Storage

A Tapestry page is a StudioCMS page whose `package` (page type) is
`tapestry/canvas`. Its content (the `content` column of
`StudioCMSPageContent`) is a JSON-serialized **stored page** (format 2, below):
the published document, an optional draft, and earlier published versions.

For compatibility, content is read as follows:

| Stored content | Read as |
| --- | --- |
| `""` (what StudioCMS stores for a new page) | Never published, empty draft |
| A format-1 `TapestryDocument` (pages saved before drafts existed) | Published, no draft, no history |
| A format-2 stored page | As stored |

Nothing is migrated in place; a page is rewritten in format 2 on its next save.

## Stored page (format 2)

Rationale: [ADR 0011](decisions/0011-draft-publish-history.md).

```ts
interface StoredPage {
  version: 2;
  published: TapestryDocument | null; // what visitors see; null until first published
  publishedAt: string | null;         // ISO 8601 (UTC, ending in Z)
  publishedBy?: string;               // display name, ≤ 100 chars
  draft: TapestryDocument | null;     // unpublished changes; null when none
  history: HistoryEntry[];            // earlier published versions, newest first
  scheduled?: {                       // a version to publish at a set time (ADR 0023)
    document: TapestryDocument;
    at: string;                       // ISO 8601 (UTC); applied by every reader once due
    by?: string;                      // who scheduled it, ≤ 100 chars
  } | null;
}

interface HistoryEntry {
  document: TapestryDocument;
  publishedAt: string;
  publishedBy?: string;
}
```

Rules (enforced by `parseStoredPage()`):

- Total length ≤ 1,000,000 × (`historyLimit` + 2) characters (7 MB with the default limit of 5).
- Every document inside (`published`, `draft`, each `history[].document`) is
  validated separately with the rules below. Issue paths are prefixed, e.g.
  `draft.root[0].props.heading`.
- `history` is cut to `historyLimit` entries. Entries without a valid document
  or date are dropped.
- Invalid dates become `null`; names are trimmed and cut to 100 characters.
- Status: **unpublished** (`published` is null), **changed** (`draft` differs
  from `published`), otherwise **published**. A draft identical to the
  published document is stored as `null`.

Who sees what:

| Viewer | Document rendered |
| --- | --- |
| Visitor (or any non-editor) | `published`; a 404 if it's `null` |
| Editor, normal page view | `published` (with the admin bar) |
| Editor with `?tapestry-preview`, or in the editor canvas | `draft ?? published` |

JSON responses (e.g. StudioCMS's REST API) are redacted the same way for
non-editors: `content` is replaced with the published document, and
never-published pages are left out.

## Document

```ts
interface TapestryDocument {
  version: 1;            // format version, for future migrations
  root: TapestryNode[];  // top-level nodes, rendered in order
}

interface TapestryNode {
  id: string;                       // unique within the document
  type: string;                     // a registered component type
  version?: number;                 // component version the props were saved with (absent: 1)
  label?: string;                   // editor-only name ("Pricing"), ≤ 60 chars, never rendered
  slot?: string;                    // the parent's named slot it's in (absent: the default area)
  props: Record<string, PropValue>; // values for the component's declared props
  children?: TapestryNode[];        // only if the component accepts children or has slots
}

type PropValue = string | number | boolean | RichTextDoc | LinkValue | ObjectValue | ObjectValue[];
// RichTextDoc: see "Rich text" below; LinkValue, ObjectValue: see "Prop types".
```

Example:

```json
{
  "version": 1,
  "root": [
    {
      "id": "section-1",
      "type": "section",
      "props": { "background": "muted" },
      "children": [
        { "id": "heading-1", "type": "heading", "props": { "text": "Hello", "level": "2" } }
      ]
    }
  ]
}
```

**Named slots** ([ADR 0027](decisions/0027-named-slots.md)): a child of a
component with `slots` says which one it's in (`"slot": "left"`). Children stay
in one array, **grouped by area**: the default area first (`acceptsChildren`),
then the slots in the order the component lists them.

```json
{ "id": "split-1", "type": "split", "props": {}, "children": [
  { "id": "text-1", "type": "text", "slot": "left", "props": { … } },
  { "id": "image-1", "type": "image", "slot": "right", "props": { … } }
] }
```

Key order is canonical (`id`, `type`, `version`, `label`, `slot`, `props`, `children`): the
editor compares documents as JSON strings (e.g. draft vs. published), so the
validator and the editor's tree operations build nodes in that order.

**Clipboard format** (copy/paste in the editor, between pages and tabs): plain
text `{"kind":"tapestry/nodes","version":1,"nodes":[TapestryNode, …]}`. Pasted
nodes are validated like stored content and get fresh ids.

## Validation rules

A document is checked against the component manifest. Validation **never
throws**. It returns a cleaned document plus a list of issues, so one bad node
doesn't blank the whole page.

| Rule | On violation |
| --- | --- |
| Content ≤ 1,000,000 characters | Whole document rejected (empty page) |
| Valid JSON, an object, `version === 1` | Whole document rejected |
| `root` / `children` are arrays | That list is dropped |
| Nesting depth ≤ 32 | Deeper lists are dropped |
| ≤ 2,000 nodes | Extra nodes are dropped |
| `id` matches `^[A-Za-z0-9_-]{1,64}$` and is unique | Node dropped |
| `type` is a registered component (own property of the manifest) | Node dropped |
| `children` only on components with `acceptsChildren` or `slots` | Children ignored (error issue) |
| A child's `slot` is one of the parent's slots | Moved to the default area (warning) if there is one, else dropped (error) |
| No `slot` under a component without a default area | Node dropped (error) |
| `slot` on a top-level node | Ignored (warning) |
| Children grouped by area (default, then slots in order) | Reordered silently (stable) |
| `label` is text (control characters removed, whitespace collapsed, ≤ 60 characters) | Ignored (warning issue if not text) |
| Undeclared props | Ignored (warning issue) |
| Missing required prop with no default | Node dropped |
| Missing optional prop with a default | Default filled in |
| Invalid prop value | Default used if there is one; otherwise the prop is dropped (or the node, if the prop is required) |

Issue `severity` is `error` (something was dropped or replaced) or `warning`
(informational, e.g. an unknown prop). `valid` is true when there are no errors.

## Prop types

| `type` | Stored as | Rules | Options |
| --- | --- | --- | --- |
| `text` | string | ≤ `maxLength` (default 500) | `maxLength`, `default` |
| `textarea` | string | ≤ `maxLength` (default 10,000) | `maxLength`, `default` |
| `url` | string | ≤ 2,048 chars; relative, or scheme `http`/`https`/`mailto`/`tel` | `default` |
| `link` | `{ type: 'page', page, newTab? }` or `{ type: 'url', url, newTab? }` | page: StudioCMS page id (1–64 of `[A-Za-z0-9_-]`); url: the `url` rules; `newTab` only as `true`; key order `type, page\|url, newTab`; a string is read as `{ type: 'url' }` | `default` (string or link) |
| `number` | number | finite; within `min`/`max` | `min`, `max`, `default` |
| `boolean` | boolean | `true`/`false` only | `default` |
| `select` | string | one of `options[].value` | `options`, `default` |
| `media` | media item id (`m_` + 16 lowercase base-36 characters) | must match the pattern; components receive the item (or null) | `accept` (kinds; default images) |
| `object` | object of field values (definition order) | each field follows its own type's rules; unknown fields ignored (warning); no field set = no value | `fields` (single-value types only), `default` |
| `list` | array of objects like `object` | ≤ `maxItems` (default 50, hard limit 100); ≥ `minItems`; invalid items dropped (error), blank items removed (warning); empty = no value | `fields`, `minItems`, `maxItems`, `itemLabel`, `default` |
| `richtext` | rich text object (below) | cleaned against `toolbar`; ≤ `maxLength` characters of text (default 20,000) | `toolbar`, `maxLength`, `default` (string or rich text) |

All types also accept `label` (required), `description`, `required`.

Components receive prop values with these JSON types intact. A `number`
arrives as a number, not a string.

## Rich text

Rationale: [ADR 0012](decisions/0012-rich-text.md). Code: [`richtext.ts`](../src/richtext.ts).
The shape is ProseMirror's `toJSON()` for the editor's schema, so the editor
reads and writes it without conversion.

```ts
interface RichTextDoc { type: 'doc'; content: Block[] }

type Align = 'left' | 'center' | 'right' | 'justify';      // left out = the site's default
type Block =
  | { type: 'paragraph'; attrs?: { textAlign: Align }; content?: Inline[] }
  | { type: 'heading'; attrs: { level: 1 | 2 | 3 | 4 | 5 | 6; textAlign?: Align }; content?: Inline[] }
  | { type: 'blockquote'; content: Block[] }
  | { type: 'bulletList' | 'orderedList'; content: ListItem[] }
  | { type: 'horizontalRule' }
  | { type: 'media'; attrs: { id: string } };              // media library item (toolbar entry `media`)
interface ListItem { type: 'listItem'; content: Block[] } // first block is a paragraph

type Inline =
  | { type: 'text'; marks?: Mark[]; text: string }       // text non-empty
  | { type: 'hardBreak' };
type Mark =
  | { type: 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript' }
  | { type: 'link'; attrs: { href: string } };          // href passes the url rules
```

Example:

```json
{ "type": "doc", "content": [
  { "type": "paragraph", "content": [
    { "type": "text", "text": "Rendered " },
    { "type": "text", "marks": [{ "type": "bold" }], "text": "server-side" }
  ] }
] }
```

Cleaning rules (`cleanRichText()`, applied by the validator; never throws):

| Input | Result |
| --- | --- |
| A string | Converted: blank lines separate paragraphs, single line breaks become `hardBreak`. No issue reported. |
| Formatting not in the prop's `toolbar` | Removed, text kept: headings → paragraphs, lists and quotes unwrapped, marks dropped (warning issue) |
| A link whose `href` fails the `url` rules, or extra link attributes | Link removed (text kept) / only `href` kept (warning) |
| Unknown node or mark types, empty text runs | Dropped (warning) |
| Marks | Deduplicated, in canonical order `link, bold, italic, underline, strike, subscript, superscript`; subscript and superscript exclude each other (subscript is kept); neighbouring runs with equal marks merge |
| An alignment the toolbar doesn't allow (or any other value) | Removed: the block uses the site's default (warning) |
| A heading level or horizontal line the toolbar doesn't allow | Heading → paragraph; line dropped (warning) |
| More than `maxLength` characters of text, 2,000 nodes, or nesting deeper than 8 | Rejected (error; the prop's default is used, or the node is dropped if required) |
| No text at all | Treated as missing (so a `required` prop fails) |
| Not an object with `type: "doc"` (and not a string) | Rejected (error) |

Toolbar entries: `bold`, `italic`, `underline`, `strike`, `subscript`, `superscript`, `link`,
`bulletList`, `orderedList`, `blockquote`, `horizontalRule`, `heading1`–`heading6`,
`alignLeft`, `alignCenter`, `alignRight`, `alignJustify`, and the action
`clearFormatting` (removes marks; not something content contains). The heading
entries appear together as one "Paragraph / Heading" dropdown and the alignment
entries as one alignment dropdown, where each group first appears in the list. Paragraphs and
line breaks are always allowed. Default toolbar: `bold`, `italic`, `link`,
`bulletList`, `orderedList`, `clearFormatting`.

Admins can narrow a field's toolbar in the dashboard (Plugins → Tapestry → Text formatting) ([ADR 0014](decisions/0014-admin-toolbar-settings.md)).
That affects editing only; the cleaning rules above (on render) use the
developer's `toolbar`. Settings are stored in `StudioCMSPluginData`, row
`@nascencestudio/tapestry-toolbars`, listing the buttons admins turned **off** (so buttons a
developer adds later are on by default): `{ "version": 2, "disabled": { "text.body": ["italic"] } }`.
Format 1 (`{ "version": 1, "fields": { …enabled buttons… } }`) is still read.

Rendering (`toRenderTree()` + `RichText.astro`) uses only these elements:
`p h1 h2 h3 h4 h5 h6 blockquote ul ol li br hr strong em u s sub sup a`. Links get
`href` only; aligned paragraphs and headings get `style="text-align: <value>"`, built
from the four allowed values only.

ProseMirror's `toJSON()` writes an unset alignment as `textAlign: null`; the editor
removes it (`stripDefaultAttrs()`) so stored values and cleaned values are byte-identical.

## Patterns (saved sections)

Stored one per row in `StudioCMSPluginData` (id `@nascencestudio/tapestry-pattern:<id>`),
[ADR 0028](decisions/0028-patterns.md):

```ts
interface Pattern {
  id: string;              // "pt_" + 16 lowercase base-36 characters
  name: string;            // node-name rules: plain text, ≤ 60 characters
  nodes: TapestryNode[];   // validated like page content; ≤ 100,000 characters as JSON
  createdAt: string;       // ISO 8601
  createdBy: string | null;     // user id (author may delete)
  createdByName: string | null;
}
```

Patterns are **copies**: inserting one validates its nodes against the current
manifest and gives them fresh ids; pages never reference a pattern.

## Translations

Each language version is its own page. Translations have a row in `StudioCMSPluginData`,
id `@nascencestudio/tapestry-language:<pageId>`, data `{ "lang": "fr", "source": "<page id of the
default-language page>" }`. A page without a row is in the default language (the first of
the `languages` option) and is its group's source. [ADR 0032](decisions/0032-translations.md).

## Media items (@nascencestudio/medialibrary)

Stored in the `NascenceMediaItems` table ([ADR 0016](decisions/0016-media-library.md)):
`id`, `kind` (`image` | `video` | `audio` | `document` | `remoteVideo`), `name`, `alt`,
`mime`, `size`, `width`, `height`, `storageKey` (the file name `<id>[-<suffix>].<ext>`, uploads;
`YYYY/MM/<file name>` before 0.2.0, migrated automatically),
`provider` + `providerId` (remote videos), `thumbnailUrl`, `createdAt`, `updatedAt`,
`createdBy`, and ([ADR 0019](decisions/0019-media-editing-extras.md), added to older
tables on first use):

- `tags`: `|a|b|` (lowercase; letters, digits, spaces, `-`, `_`; at most 20), `''` for none.
- `focalX`, `focalY`: images, 0–100 (percent), or null (center).
- `tracks`: JSON `[{ id: "t_<8>", kind: "subtitles"|"captions", srclang, label, storageKey }]`
  (uploaded videos; the files are cleaned WebVTT).
- `variants`: JSON `[{ width, height, mime: "image/webp", storageKey }]` (resized copies).
- `folderId` (0.2.0): the item's folder (`f_<16>`), or null for the top level.

Folders (0.2.0, [medialibrary ADR 0100](https://github.com/nascencestudio/medialibrary/blob/main/docs/decisions/0100-folders.md)) are in `NascenceMediaFolders`: `id` (`f_<16>`),
`parentId` (null: top level), `name` (display, unique among siblings regardless of case),
`slug` (its directory name: `[a-z0-9-]`, unique among siblings), `createdAt`, `updatedAt`.
On disk, a file lives at `<storage dir>/<folder slugs…>/<file name>`; its URL is
`/files/<file name>` wherever it lives.

Storage keys of replacement files, variants and caption files carry a random suffix
(`m_…-<token>.<ext>`), so their URLs are new: files are served as immutable.
Everything read from these columns is validated again (`stored.ts`).

Pages refer to items by id only (in `media` props and rich text media blocks); a page
"uses" an item when its stored content contains the id. Replacing a file keeps the id,
so every page shows the new file.

## Naming rules (component definitions)

- Component `type`: kebab-case, `^[a-z][a-z0-9]*(-[a-z0-9]+)*$` (e.g. `hero`, `card-grid`).
- Prop names: `^[a-zA-Z][a-zA-Z0-9]*$` (camelCase recommended).
- Reserved prop names: `class`, `classList`, `style`, `id`, `slot`, `is`,
  `children`, `key`, `ref`, and **anything starting with `on`**. A component
  that spreads its props onto an element would otherwise turn editor text into
  an inline event handler.

## Versioning

The document format is still `version: 1`; the stored page wrapper is
`version: 2` (the two share one number space, so a stored value is
unambiguous: the next document format is **3**). `version` is bumped for any change that
older renderers couldn't read; `FORMAT_MIGRATIONS` (`migrations.ts`) upgrades stored
documents on read, and a newer format than the code knows is refused. Adding optional
fields that old renderers can safely ignore doesn't bump the version.

**Component versions** ([ADR 0031](decisions/0031-migrations.md)): a node's `version` is the
version of its component it was saved with (written only when above 1). When a component's
`version` is higher, its prop migrations run on read (on a copy, then validated as usual);
`replaces` maps old component types to the new one. Upgraded pages are saved in the new shape
the next time they're edited.

## Planned extensions (not in v1)

- Linked patterns (a node referencing a shared subtree, edited once for every page). Patterns as
  copies are done: see "Patterns" above.
- Per-node metadata (`label` for the layer tree, `hidden` toggle).
