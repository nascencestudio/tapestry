# @nascencestudio/tapestry

**Drag-and-drop, component-based page building for [Astro](https://astro.build) + [StudioCMS](https://studiocms.dev).**

Register your own Astro components with a typed prop schema; editors compose
pages from them in the StudioCMS dashboard on a live canvas of the real page.
Pages are stored as validated JSON and rendered on the server as your
components, with **no client JavaScript unless a component opts in**.

- Visual canvas with drag and drop, inline text editing, keyboard navigation
- Drafts, publishing, scheduled publishing, version history and comparison
- Rich text (ProseMirror, per-field toolbars), links, media (with
  [`@nascencestudio/medialibrary`](https://github.com/nascencestudio/medialibrary)), lists and objects, named slots
- Patterns (saved sections), translations, component permissions, migrations
- Interactive components (Astro islands) when a component opts in

Inspired by [Drupal Canvas](https://www.drupal.org/project/canvas). The editor is built with
[Preact](https://preactjs.com) (about 35 KB gzipped on first load, dashboard only); page content is
treated as untrusted input: strict schema validation, size and depth limits, URL scheme
allowlists and an element allowlist on the rendered output ([security](docs/security.md)).

## Requirements

- Node ≥ 22.12, Astro 7, StudioCMS 0.6
- An on-demand (SSR) Astro adapter, as StudioCMS requires

## Install

```sh
pnpm add @nascencestudio/tapestry
```

## Set up

**1. Define components** (any `.astro` file can be one):

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
      link: { type: 'link', label: 'Button link' },
    },
  }),
];
```

**2. Register the plugin** and Tapestry's component registry entries (StudioCMS
plugins can't add those themselves):

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

**3. Load pages with `getPage()`** in your page route. It enforces draft
visibility (StudioCMS's own `bySlug` returns drafts) and picks the published
version for visitors:

```astro
---
// src/pages/[...slug].astro
import { StudioCMSRenderer } from 'studiocms:renderer';
import { getPage } from '@nascencestudio/tapestry/page';
import AdminBar from '@nascencestudio/tapestry/AdminBar.astro';

const result = await getPage(Astro);
if (!result) return new Response(null, { status: 404 });
const { page, viewer, publishing } = result;
---
<html lang="en">
  <body>
    <AdminBar viewer={viewer} page={page} publishing={publishing} />
    <StudioCMSRenderer data={page} />
  </body>
</html>
```

Then create a page of type **Tapestry (visual builder)** in the dashboard and
build it on its **Page Content** tab.

## Interactive components need a StudioCMS patch

StudioCMS 0.6.1 removes every `<script>` that components render from page
content, so islands (`client: 'visible'` etc.) never become interactive and
`<script>`s in your components don't run. Until StudioCMS changes this, apply the
small patch that ships with this package (it only affects page types that opt in,
like Tapestry):

```sh
mkdir -p patches
cp node_modules/@nascencestudio/tapestry/patches/studiocms@0.6.1.patch patches/
```

```yaml
# pnpm-workspace.yaml
patchedDependencies:
  studiocms@0.6.1: patches/studiocms@0.6.1.patch
```

Then `pnpm install`. (With npm, use [patch-package](https://github.com/ds300/patch-package)
with the same file.) Sites without interactive components don't need it.

## Documentation

- [Defining components](docs/guides/defining-components.md): prop types, slots, lists, links, media, islands, migrations, permissions
- [Site integration](docs/admin-bar.md): `getPage()`, the admin bar, translations, 404 page
- [Security](docs/security.md), the [data model](docs/data-model.md) and the [architecture](docs/architecture.md)
- [Known issues](docs/known-issues.md), the [roadmap](docs/roadmap.md) and the [design decisions](docs/decisions/)

## Development

Requires Node ≥ 22.12 and pnpm ≥ 12 (**pnpm only**; the supply-chain policies in
`pnpm-workspace.yaml` apply to every install).

```sh
pnpm install
pnpm build      # dist/
pnpm test       # unit tests (Vitest)
pnpm typecheck && pnpm lint
```

The dev site, browser tests and deployment setup live in
[nascencestudio/tapestry-playground](https://github.com/nascencestudio/tapestry-playground).
See [Contributing and development](docs/guides/development.md).

## How Tapestry is built

Tapestry is developed with an AI coding assistant (Anthropic's Claude), directed by its
maintainer at Nascence Studio, who sets the requirements, makes the decisions and checks the
results. Commits written with its help say so (`Co-Authored-By`).

What keeps that accountable:

- **Decisions are written down.** Every significant choice has a decision record in
  [docs/decisions](docs/decisions/), with the alternatives considered and why they lost.
  A [devlog](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/devlog.md)
  records each working session, mistakes included.
- **Behaviour is tested.** Unit tests cover the plugin's logic, with adversarial cases for
  everything that handles untrusted input (validation, URLs, rich text). Browser tests drive
  the real editor in Chrome, including drag and drop, publishing and an accessibility audit in
  both dashboard themes; they live in
  [tapestry-playground](https://github.com/nascencestudio/tapestry-playground).
- **Security is designed in.** Page content is treated as untrusted input from start to finish,
  and the threat model is in [docs/security.md](docs/security.md). Dependencies are minimal,
  pinned and reviewed before they're added; pnpm's supply-chain checks run on every install.
- **Releases are traceable.** Versions are published from GitHub Actions with npm provenance,
  and each one is approved by a person with two-factor authentication.

Found a problem? Please [open an issue](https://github.com/nascencestudio/tapestry/issues).

## License

MIT © Nascence Studio
