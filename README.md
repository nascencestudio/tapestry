# Tapestry

**Drag-and-drop, component-based page building for [Astro](https://astro.build) + [StudioCMS](https://studiocms.dev).**

Tapestry brings a [Drupal Canvas](https://www.drupal.org/project/canvas)-style
visual page builder to StudioCMS. Developers register ordinary Astro
components with a typed prop schema. Editors compose pages from those components
in the StudioCMS dashboard. Pages are stored as validated JSON and rendered on
the server as real Astro components, with **no client JavaScript by default**.

> **Status: 0.1.0, preparing the first public release.** Everything in the
> [roadmap](docs/roadmap.md) through Phase 5 works end to end (visual canvas, publishing,
> rich content, translations, permissions, islands, migrations), with ~400 unit tests and
> ~200 browser e2e steps. Install instructions: [packages/tapestry](packages/tapestry).

## Why

- **Your components, not a theme's.** Anything you can write as an `.astro` file can become a building block.
- **Fast pages.** Server-rendered HTML; components opt in to interactivity.
- **Edit on the real page.** The canvas shows the page exactly as visitors will see it, with your site's own layout and CSS, updating live as you drag, drop and type. Desktop, tablet and mobile widths, plus a full-screen workspace.
- **Light editor.** Built with [Preact](https://preactjs.com): the editor, canvas included, is about 35 KB gzipped on first load, and the rich text editor (ProseMirror, ~67 KB) loads separately when needed. All of it loads only in the dashboard.
- **Rich text with a toolbar you choose.** Developers pick each field's buttons (bold, italic, links, lists, headings, quotes, remove formatting…); that list is also what's allowed, even on paste. Site admins can switch buttons off in the dashboard. Edit text in the settings panel or directly on the page. Stored as structured JSON and rendered without raw HTML. See ADRs [0012](docs/decisions/0012-rich-text.md), [0013](docs/decisions/0013-inline-canvas-editing.md), [0014](docs/decisions/0014-admin-toolbar-settings.md).
- **Drafts and publishing.** Saving keeps changes as a draft; visitors see the published version until you click **Publish**. Preview drafts on the real page, discard changes, and restore any of the last 5 published versions. See [ADR 0011](docs/decisions/0011-draft-publish-history.md).
- **Media library.** A companion plugin, [`@nascencestudio/medialibrary`](https://github.com/nascencestudio/medialibrary): upload images (including AVIF and sanitized SVG), video, audio and documents, or add YouTube/Vimeo links; reuse them in components (`media` props) and rich text; see where each item is used. See [ADR 0016](docs/decisions/0016-media-library.md).
- **Drupal-style admin bar.** Logged-in editors get a toolbar on the public site (Edit page, Add page, Dashboard) and a View page button in the editor. Visitors get none of it, and drafts stay private. See [admin bar](docs/admin-bar.md).
- **Secure by default.** Page content is treated as untrusted input: strict schema validation, size and depth limits, URL scheme allowlists, and an element allowlist on the rendered output. See [security](docs/security.md).

## What it looks like

Register components:

```js
// src/tapestry.config.mjs
import { defineComponent } from '@nascencestudio/tapestry';

export const components = [
  defineComponent({
    type: 'hero',
    label: 'Hero',
    component: './src/components/Hero.astro',
    props: {
      heading: { type: 'text', label: 'Heading', required: true },
      ctaHref: { type: 'url', label: 'Button link' },
    },
  }),
];
```

Add the plugin:

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

Create a page of type **Tapestry (visual builder)** in the dashboard, then
build it on its **Page Content** tab: drag components from the library onto the
live canvas (or the layer tree), click them to edit their settings in a form
generated from your prop schema, and watch the real page update.
A page is stored as a tree like this:

```json
{
  "version": 1,
  "root": [
    { "id": "hero-1", "type": "hero", "props": { "heading": "Hello" } }
  ]
}
```

## Repository

| Path | Contents |
| --- | --- |
| [`packages/tapestry`](packages/tapestry) | The StudioCMS plugin (`@nascencestudio/tapestry`) |
| [`nascencestudio/medialibrary`](https://github.com/nascencestudio/medialibrary) | The media library plugin (`@nascencestudio/medialibrary`), in its own repository |
| [`website`](website) | The documentation site (Starlight, generated from `docs/`) |
| [`Dockerfile`](Dockerfile), [`compose.yaml`](compose.yaml) | Production deployment (see [docs/guides/deployment.md](docs/guides/deployment.md)) |
| [`playground`](playground) | Astro + StudioCMS site for developing and testing the plugin |
| [`docs`](docs) | Architecture, data model, decisions, guides, devlog |
| [`CLAUDE.md`](CLAUDE.md) | Project brief, rules, and current status |

## Development

Requires Node ≥ 22.12 and pnpm ≥ 12. This project uses **pnpm only**.

```sh
pnpm install
pnpm -r build
pnpm test
```

Deploying to a server with Docker: [docs/guides/deployment.md](docs/guides/deployment.md).

Full setup, including the database and first login: [docs/guides/development.md](docs/guides/development.md).

## License

[MIT](LICENSE) © Nascence Studio
