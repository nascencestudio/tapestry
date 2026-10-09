# Defining components

Any Astro component can become a Tapestry building block. You describe it
with `defineComponent()`; Tapestry handles editing, validation, and rendering.

## 1. Write the Astro component

```astro
---
// src/components/tapestry/Hero.astro
interface Props {
  heading: string;
  subheading?: string;
  ctaHref?: string;
  align?: 'left' | 'center';
}
const { heading, subheading, ctaHref, align = 'left' } = Astro.props;
---
<header class={`hero hero--${align}`}>
  <h1>{heading}</h1>
  {subheading && <p>{subheading}</p>}
  {ctaHref && <a href={ctaHref}>Learn more</a>}
</header>
```

Render props as text expressions (`{heading}`), never `set:html`.

## 2. Register it

```js
// src/tapestry.config.mjs
import { defineComponent } from '@nascencestudio/tapestry';

export const components = [
  defineComponent({
    type: 'hero',                       // kebab-case, unique
    label: 'Hero',                      // shown in the editor
    description: 'Large heading with optional call to action.',
    category: 'Content',                // groups the library panel
    component: './src/components/tapestry/Hero.astro', // relative to project root
    props: {
      heading:    { type: 'text', label: 'Heading', required: true, maxLength: 120 },
      subheading: { type: 'textarea', label: 'Subheading' },
      ctaHref:    { type: 'url', label: 'Button link' },
      align: {
        type: 'select',
        label: 'Alignment',
        options: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
        ],
        default: 'left',
      },
    },
  }),
];
```

## 3. Wire up the plugin (once)

```js
// studiocms.config.mjs
import tapestry, { tapestryComponentRegistry } from '@nascencestudio/tapestry';
import { defineStudioCMSConfig } from 'studiocms/config';
import { components } from './src/tapestry.config.mjs';

export default defineStudioCMSConfig({
  componentRegistry: { ...tapestryComponentRegistry() },
  plugins: [tapestry({ components })],
});
```

Plugin options:

| Option | Default | Meaning |
| --- | --- | --- |
| `components` | (required) | The component definitions editors can use |
| `pageUrlPattern` | `'/{slug}'` | Public URL of a page, for "View page" and the canvas ([admin bar](../admin-bar.md)) |
| `historyLimit` | `5` | Earlier published versions kept per page for restoring ([ADR 0011](../decisions/0011-draft-publish-history.md)) |

The plugin also adds an Astro middleware that removes unpublished Tapestry
content from JSON responses for anyone who isn't an editor (StudioCMS's public
REST API would otherwise expose drafts; see [security](../security.md#unpublished-content-drafts-and-history)).

## Reference

### `defineComponent(definition)`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `type` | string | ✓ | `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, unique |
| `label` | string | ✓ | |
| `component` | string | ✓ | Path to a `.astro` file (or a framework component: `.tsx`, `.jsx`, `.svelte`, `.vue`), relative to the project root |
| `client` | `'load' \| 'idle' \| 'visible'` | | Make a framework component interactive (an island); see below |
| `permission` | `'editor' \| 'admin' \| 'owner'` | | Lowest role that may add, change, move or remove it (default `'editor'`); see below |
| `version` | number | | The component's version (default 1); raise it with a migration when stored props change shape |
| `migrations` | string | | Module with the prop migrations (`.js`, `.mjs`, `.ts`), relative to the project root |
| `replaces` | `string[]` | | Type names the component had before (stored nodes move to it) |
| `description` | string | | |
| `category` | string | | |
| `props` | `Record<name, PropDefinition>` | | Only declared props are ever passed to the component |
| `acceptsChildren` | boolean | | Children render into the component's default `<slot />` |
| `slots` | `Record<name, { label, description? }>` | | Named areas for children (see "Children") |
| `thumbnail` | string | | Image for the editor's library (`.png`, `.jpg`, `.webp`, `.avif`, `.gif`, `.svg`), relative to the project root. Without one, hovering the component shows a live preview. |

Throws `TapestryDefinitionError` at config load for invalid names, reserved
prop names, a select `default` that isn't one of its options, `min > max`, an unknown or
repeated rich text `toolbar` button, a rich text `default` the toolbar doesn't
allow, a non-`.astro` path, a `thumbnail` that isn't an image file, bad slot names,
or invalid `object`/`list` fields.

In the editor's library, hovering (or focusing) a component shows a preview: the
component rendered with the values a new one starts with, styled like your site.
A `thumbnail` replaces that preview with your picture, which helps for layouts
that look empty until something is dropped in ([ADR 0029](../decisions/0029-library-previews.md)).

### Prop definitions

Every prop: `label` (required), `description?`, `required?`.

| `type` | Value your component receives | Extra options |
| --- | --- | --- |
| `text` | `string` | `maxLength` (default 500), `default` |
| `textarea` | `string` (may contain newlines) | `maxLength` (default 10,000), `default` |
| `url` | `string`: relative, or `http`/`https`/`mailto`/`tel` | `default` |
| `link` | `ResolvedLink \| null` (below) | `default` (a web address string, or `{ type: 'page' \| 'url', … }`) |
| `number` | `number` | `min`, `max`, `default` |
| `boolean` | `boolean` | `default` |
| `select` | `string` (one of the option values) | `options` (required), `default` |
| `object` | object of field values, or `undefined` (below) | `fields`, `default` |
| `list` | array of objects, or `undefined` (below) | `fields`, `minItems`, `maxItems` (default 50, at most 100), `itemLabel`, `default` |
| `richtext` | rich text object (render it with `<RichText>`, below) | `toolbar`, `maxLength` (default 20,000 characters of text), `default` (plain string or rich text) |

Optional props without a value and without a `default` are **absent**
(`undefined`), so give your component sensible fallbacks.

### Rich text

A `richtext` prop gives editors a formatting toolbar ([ADR 0012](../decisions/0012-rich-text.md)).
List the buttons they get; the list is also what's *allowed*, so formatting
outside it is removed from stored and pasted content.

```js
defineComponent({
  type: 'text',
  label: 'Text',
  component: './src/components/tapestry/Text.astro',
  props: {
    body: {
      type: 'richtext',
      label: 'Body',
      required: true,
      toolbar: ['bold', 'italic', 'link', 'bulletList', 'orderedList', 'heading3'],
    },
  },
});
```

Toolbar entries: `bold`, `italic`, `underline`, `strike`, `subscript`, `superscript`, `link`,
`bulletList`, `orderedList`, `blockquote`, `horizontalRule`, `heading1`–`heading6`,
`alignLeft`, `alignCenter`, `alignRight`, `alignJustify`, and the action
`clearFormatting` (a "remove formatting" action). The `heading*` entries form one
"Paragraph / Heading" dropdown (offering only the listed levels) and the `align*`
entries one alignment dropdown (plus "Default alignment"); each dropdown appears where
its first entry is in your list. Paragraphs and line breaks
(Shift+Enter) are always available. Without `toolbar`, editors get bold, italic,
link, both list types and remove formatting. An empty list (`toolbar: []`) gives
plain paragraphs with no buttons.

Your `toolbar` is the most a field can have. Site admins can turn buttons off
(not on) in the dashboard under Plugins → **Tapestry** → **Text formatting**
([ADR 0014](../decisions/0014-admin-toolbar-settings.md)).

Rich text rendered with `<RichText>` is also editable **directly on the canvas**
([ADR 0013](../decisions/0013-inline-canvas-editing.md)). Pass the prop value to
`RichText` unchanged (not a copy or a transformed value), so the canvas can tell
which field it belongs to.

Render the value with the `RichText` component. It outputs only `p`, `h1`–`h6`,
`blockquote`, `ul`, `ol`, `li`, `br`, `hr`, `strong`, `em`, `u`, `s`, `sub`, `sup` and `a`
(alignment as a `text-align` style attribute), with all
text escaped. Never pass rich text to `set:html`.

```astro
---
// src/components/tapestry/Text.astro
import RichText from '@nascencestudio/tapestry/RichText.astro';
import type { RichTextDoc } from '@nascencestudio/tapestry';
interface Props { body: RichTextDoc }
const { body } = Astro.props;
---
<div class="text"><RichText value={body} /></div>
<style>
  /* RichText's elements aren't in this component's scope; use :global() */
  .text :global(p) { margin: 0 0 1em; }
</style>
```

Switching an existing prop from `textarea` to `richtext` is safe: stored plain
text converts automatically (blank lines become paragraphs). Changing a
`toolbar` later is safe too: formatting that's no longer allowed is removed
when the page is read, and the text stays.

Helpers exported from `@nascencestudio/tapestry` for custom rendering or search:
`richTextToPlain()`, `richTextFromPlain()`, `toRenderTree()`, `isRichTextEmpty()`.

### Who can use a component (permissions)

```ts
defineComponent({ type: 'pricing', label: 'Pricing table', component: '…', permission: 'admin' });
```

Editors below the role see the component **locked**: a lock in the library and the page
structure, read-only settings, no moving or deleting. They can still arrange other
components around and inside it, and publish or restore versions an admin made. The
server refuses any save that changes a locked component, so this holds for crafted
requests too. See [ADR 0033](../decisions/0033-component-permissions.md).

### Changing a component without breaking pages (migrations)

Pages store prop values. When you rename a prop, change its shape or rename a
component, give the component a new `version` and a migration:

```ts
defineComponent({
  type: 'counter',
  label: 'Counter',
  component: './src/components/tapestry/Counter.tsx',
  version: 2,
  migrations: './src/components/tapestry/counter.migrations.mjs',
  replaces: ['tally'], // optional: the type names it had before
  props: { initial: { type: 'number', label: 'Starts at', default: 0 } },
});
```

```js
// counter.migrations.mjs: one function per version, upgrading from the version before.
export default {
  // Version 2: `start` was renamed to `initial`.
  2: ({ start, ...props }) => (start === undefined ? props : { ...props, initial: start }),
};
```

- Pages are upgraded when they're read (by visitors and in the editor) and saved in the
  new shape on their next edit, so keep every step: old pages may be at any version.
- Migrations get a copy of the props and return new props, which are then validated as
  usual. They run on the server and in the editor: plain JavaScript, no side effects.
- A migration that throws keeps the earlier props (validation drops what no longer fits).
- Adding an optional prop, or a new option to a select, doesn't need a new version.

See [ADR 0031](../decisions/0031-migrations.md).

### Interactive components (islands)

Tapestry components are server-rendered with no JavaScript. To make one
interactive, point `component` at a framework component and add `client`:

```ts
defineComponent({
  type: 'counter',
  label: 'Counter',
  component: './src/components/tapestry/Counter.tsx', // needs the site's @astrojs/preact
  client: 'visible', // or 'load' / 'idle'
  props: { label: { type: 'text', label: 'Label', required: true } },
});
```

- The site needs that framework's Astro integration (`@astrojs/preact`, Svelte,
  Vue…). Tapestry generates a small `.astro` wrapper per interactive component
  (`node_modules/.tapestry/islands/`) because Astro only hydrates statically
  imported components.
- Only pages that use the component load its JavaScript. Without `client`, a
  framework component renders to plain HTML.
- Props arrive as serialized data (media items and links resolved). They're
  visible in the page source, like any Astro island.
- In the editor's canvas the island hydrates after it's added, but clicks select
  the component instead of interacting with it.
- `.astro` components can also contain islands or `<script>`s themselves. Scripts run
  once per page, so on the canvas (where components appear and re-render while
  editing) write them as custom elements, as Astro recommends.

See [ADR 0030](../decisions/0030-islands.md).

### Lists (repeaters) and objects

A `list` prop is a repeater: editors add, remove and reorder items that all have
the same `fields`. An `object` prop groups a few fields edited together. Fields use
the single-value types above (text, textarea, url, number, boolean, select,
richtext, media, link), with the same options; they can't be lists or objects.

```ts
props: {
  items: {
    type: 'list',
    label: 'Questions',
    itemLabel: 'question',          // "Add question"
    required: true,                 // at least one item (or use minItems)
    maxItems: 30,
    fields: {
      question: { type: 'text', label: 'Question', required: true },
      answer: { type: 'richtext', label: 'Answer', toolbar: ['bold', 'link'] },
      open: { type: 'boolean', label: 'Open at first', default: false },
    },
  },
  more: {
    type: 'object',
    label: 'More help',
    fields: {
      label: { type: 'text', label: 'Text' },
      link: { type: 'link', label: 'Link' },
    },
  },
},
```

Your component receives arrays and objects of field values, with defaults filled
in and `media`/`link` fields resolved (to `MediaItem | null` and
`ResolvedLink | null`). Items with a missing or invalid required field are left
out; an empty list or an object with no field set arrives as `undefined`.

```astro
---
import type { ResolvedLink, RichTextDoc } from '@nascencestudio/tapestry';
import RichText from '@nascencestudio/tapestry/RichText.astro';
interface Props {
  items?: Array<{ question: string; answer?: RichTextDoc; open: boolean }>;
  more?: { label?: string; link: ResolvedLink | null };
}
const { items = [], more } = Astro.props;
---
{items.map((item) => (
  <details open={item.open}>
    <summary>{item.question}</summary>
    {item.answer && <RichText value={item.answer} />}
  </details>
))}
```

Text inside lists and objects is edited in the settings panel, not on the canvas.
See [ADR 0026](../decisions/0026-list-and-object-props.md).

### Links

A `link` prop lets editors pick a **page on this site** (stored by id, so renaming
the page doesn't break the link) or type a **web address**, and choose "Open in a
new tab". Your component receives a `ResolvedLink`, or `null` when there's no link
(not set, the page was deleted, or the page is a draft and the visitor isn't an
editor):

```ts
interface ResolvedLink {
	href: string;           // '/about', 'https://…', 'mailto:…'
	external: boolean;      // another host, mailto: or tel:
	newTab: boolean;
	rel: string | undefined; // 'noopener noreferrer' when newTab
	title: string | null;   // the page's title, for page links
}
```

```astro
---
import type { ResolvedLink } from '@nascencestudio/tapestry';
interface Props { label: string; href?: ResolvedLink | null }
const { label, href } = Astro.props;
---
<a href={href?.href} target={href?.newTab ? '_blank' : undefined} rel={href?.rel}>{label}</a>
```

Switching an existing `url` prop to `link` is safe: stored strings are read as
web addresses (the component then receives a `ResolvedLink` instead of a string).
See [ADR 0025](../decisions/0025-link-prop.md).

### Media (images, video, audio, documents)

With [`@nascencestudio/medialibrary`](https://github.com/nascencestudio/medialibrary) installed, a
`media` prop lets editors choose an item from the media library (or upload one):

```js
backgroundImage: { type: 'media', label: 'Background image', accept: ['image'] },
```

`accept` lists the kinds that can be chosen: `image`, `video`, `audio`, `document`,
`remoteVideo` (default: images). The document stores the item's id; your
component receives the item (or `null` if none is chosen, it was deleted, or the
library isn't installed):

```astro
---
import Media from '@nascencestudio/medialibrary/Media.astro';
import type { MediaItem } from '@nascencestudio/tapestry';
interface Props { backgroundImage?: MediaItem | null; photo?: MediaItem | null }
const { backgroundImage, photo } = Astro.props;
---
<section style={backgroundImage ? `background-image: url("${backgroundImage.url}")` : undefined}>
  <Media item={photo} />  <!-- image, player, embed or document link -->
</section>
```

`MediaItem` has `url`, `alt`, `kind`, `name`, `width`, `height`, `mime`, `size`,
`embedUrl` (remote videos), `thumbnailUrl`, `tags`, and:

- `srcset` / `variants`: resized WebP copies of raster images (narrowest first), for
  `<img srcset>` or picking a size for a CSS background.
- `focalPoint`: `{ x, y }` in percent (or null): use it as `object-position` /
  `background-position` so crops keep the important part.
- `tracks`: caption/subtitle tracks of uploaded videos (`<track kind src srclang label>`).

URLs come from the library (validated storage keys or provider ids), so they're safe
to use in attributes and CSS. The easiest way to get all of this right is the
library's component: `<Media item={photo} sizes="(min-width: 60rem) 50vw, 100vw" class="cover" />`
(srcset, focal point and captions included).

In rich text, add `media` to the `toolbar` for an "Insert media" button; limit the
kinds with `mediaAccept: ['image', 'remoteVideo']`.

### Reserved prop names

`class`, `classList`, `style`, `id`, `slot`, `is`, `children`, `key`, `ref`,
and any name starting with `on` (even harmless ones like `online`). See
[security](../security.md#defenses-in-the-render-pipeline).

### Children

Set `acceptsChildren: true` and put a `<slot />` where children should go.

For several areas, declare **named slots** and use Astro's named slots in the
component. Editors drop components into each area (on the canvas and in the page
structure); visitors get ordinary server-rendered HTML.

```ts
defineComponent({
  type: 'split',
  label: 'Two columns',
  component: './src/components/tapestry/Split.astro',
  slots: {
    left: { label: 'Left column' },
    right: { label: 'Right column' },
  },
});
```

```astro
<div class="split">
  <div class="split__column"><slot name="left" /></div>
  <div class="split__column"><slot name="right" /></div>
</div>
```

Slot names follow the prop name rules (and can't be `default`). A component can
have both `acceptsChildren` (the default `<slot />`) and `slots`. Empty slots
aren't passed, so `Astro.slots.has('left')` tells you whether there's content.
On the canvas, put each slot inside its own element (like the columns above):
that element is the area editors drop onto. See
[ADR 0027](../decisions/0027-named-slots.md).

## Site CSS and the StudioCMS dashboard

In `astro dev`, StudioCMS dashboard pages also load the **global CSS of every page
in your site** (known issue #14; production is unaffected). Unscoped site styles
can therefore restyle the dashboard, for example making light mode unreadable.
Write site-wide CSS defensively:

- Scope global rules to a class on `<body>` (the playground uses `<body class="site">`),
  not to `body`, `html`, `:root` or bare elements like `a`.
- Namespace custom properties (`--site-text`, `--site-brand`), because StudioCMS uses
  generic names such as `--background` and `--text` itself.
- Component styles in `.astro` files are scoped automatically and are safe.

```astro
<body class="site"><slot /></body>

<style is:global>
  .site { --site-text: #1a1a1f; --site-brand: #4f46e5; color: var(--site-text); }
  .site a { color: var(--site-brand); }
</style>
```

Restart the dev server after changing global site CSS; the dashboard may keep the old copy.

## Editing text on the canvas

Editors can type directly into a component's text on the visual canvas:

- **Rich text** props: render them with `<RichText value={body} />` (it marks itself).
- **Plain `text` props**: nothing to do in most components. When a component is
  selected, the canvas finds the element that shows each text prop (the one element
  without child elements whose text equals the value) and makes it editable. If your
  markup changes the value before showing it (adds a prefix, joins two props, …),
  mark the element so the canvas can still find it:

  ```astro
  <h2 data-tapestry-text-prop="title">{title}</h2>
  ```

  The attribute is harmless on public pages. Without a match, the prop is edited in
  the settings panel as usual (see ADR 0024).
