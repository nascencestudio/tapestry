# CLAUDE.md: Tapestry

This file is the source of truth for anyone (human or AI) working in this repo.
Read it fully at the start of every session. Keep it current: if something here
is wrong, fixing it is part of the task.

## What Tapestry is

A drag-and-drop, component-based page builder for **Astro + StudioCMS**,
inspired by [Drupal Canvas](https://www.drupal.org/project/canvas). Developers register
Astro components with a typed prop schema; editors arrange them into pages in
the StudioCMS dashboard; pages are stored as a validated JSON tree and rendered
server-side as real Astro components, with zero client JS by default.

It ships as a **StudioCMS plugin** (`@nascencestudio/tapestry`) that registers a page
type (`tapestry/canvas`) with its own editor and renderer. A companion plugin,
**`@nascencestudio/medialibrary`**, adds a Drupal-style media library; it lives in its own
repository, [nascencestudio/medialibrary](https://github.com/nascencestudio/medialibrary)
(ADR 0037), and this repo uses it as an npm dependency. All packages
are under the user's business, Nascence Studio (`@nascencestudio`, ADR 0015).

**This repository is the plugin only** (ADR 0038): the package lives at the root. Development
happens across sibling checkouts in `/Volumes/T7/www/`:

| Repo | Folder | What |
| --- | --- | --- |
| nascencestudio/tapestry | `tapestry/` (here) | the plugin, unit tests, user docs, ADRs, docs site |
| nascencestudio/tapestry-playground | `tapestry-playground/` | dev site, browser e2e, perf budget, Docker deploy, dependency patches, **devlog**, research notes, upstream drafts (its own CLAUDE.md) |
| nascencestudio/medialibrary | `medialibrary/` | `@nascencestudio/medialibrary` (its own CLAUDE.md) |

## Current status (update every session)

| Phase | Scope | Status |
| --- | --- | --- |
| 0. Foundation | Monorepo, supply-chain hardening, docs, playground | ✅ Done (2026-10-02); split into repos 2026-10-08/09 (ADRs 0037, 0038) |
| 1. Render pipeline | Data model, validator, renderer, page type, JSON editor, tests | ✅ Done (2026-10-02) |
| 2. Visual editor MVP | Preact editor: library, layer tree, drag and drop, prop forms, undo, JSON view, e2e; + collapse/expand, auto-scroll, node names, copy/paste (2026-10-06) | ✅ Done (2026-10-02) |
| Site integration | Draft-safe `getPage()`, admin bar, View page, preview | ✅ Done (2026-10-06; edit-screen "View page" and shareable previews dropped by the user) |
| 3. Visual canvas | Real page in an iframe, live updates, click/drag on the canvas, viewports, full screen; + empty-container drop zones, keyboard navigation, partial re-render (2026-10-07) | ✅ Done (2026-10-05) |
| Publishing | Drafts, Publish, 5-version history, restore, discard, draft preview; + scheduling, version comparison, publish permission (2026-10-07) | ✅ Done (2026-10-05) |
| Media library | `@nascencestudio/medialibrary`: uploads, remote video, Media page, picker, Tapestry `media` props + rich text, admin upload settings, replace file, tags, captions, focal point, resized images | ✅ Done (2026-10-06); moved to its own repo 2026-10-08 (ADR 0037) |
| Deployment | Docker + Caddy for a Hetzner Cloud server; CI (GitHub Actions, ADR 0020) | ✅ Done (2026-10-06) |
| 4. Rich content | Images, rich text, links, repeaters, named slots, patterns, library previews | ✅ Done (2026-10-07) |
| 5. Production | Islands, migrations, i18n, permissions, a11y, perf budget, npm publish, docs site | ✅ Done (2026-10-08) except the actual npm publish: prepared (repos: nascencestudio/tapestry, nascencestudio/medialibrary); the user releases |

Full plan: [docs/roadmap.md](docs/roadmap.md). Session history: the devlog in tapestry-playground (`../tapestry-playground/docs/devlog.md`).

**Immediate next steps**
1. Release (the user does it; never publish locally, ADR 0035/0037/0038):
   a. ✅ medialibrary 0.1.1 released via trusted publisher (stage only) + 2FA approval.
   b. This repo: the user force-pushes the plugin-only `main` (replacing the pushed monorepo
      commit), enables Pages, adds the `NPM_TOKEN` secret, publishes release `v0.1.0`, approves the
      staged version; then the trusted publisher (stage only), publishing access "2FA, no bypass
      tokens", deletes the token + secret, and we remove `NODE_AUTH_TOKEN` from release.yml.
   c. tapestry-playground: create the GitHub repo, push; then switch its
      `@nascencestudio/tapestry` from `file:../tapestry` to `0.1.0` (its CI and Docker need that).
   d. File the StudioCMS issue drafted in tapestry-playground/docs/upstream/.
2. Report upstream (only when the user asks): `bySlug` drafts (#10), ignored config keys (#5),
   dev-toolbar DB viewer errors (#12), empty page type (#15), edit-screen crash/no delete (#16),
   HTML editor in dev (#19) and never saving (#20) (plugin since removed; still worth reporting),
   public REST API exposes content (#22), SQLite locking fails saves (#23),
   plugin data can't be saved (#25), middleware imports a dashboard component (#32),
   @studiocms/md global CSS (#33), unauthenticated dev SQL endpoint + external DB iframe (#12),
   404 page is the dashboard layout (#34), rendered output re-sanitized so component scripts are
   dropped (#37); Astro: dev CSS collector crosses the manifest (#32).
3. Re-check the ignored braces advisory on 2026-11-01 (known issue #8).

## Non-negotiable rules

1. **Security first.** Pick the most secure option for tooling and code.
   - **pnpm only.** Never run `npm` or `yarn`, not even `npm view`; use `pnpm view`.
   - Never weaken `pnpm-workspace.yaml` hardening without an ADR or devlog entry
     explaining why. Every `overrides` / `allowBuilds` / `peerDependencyRules`
     entry has a written reason.
   - Pin exact versions (`saveExact: true`). After editing a `package.json` by
     hand, run `pnpm install` (`verifyDepsBeforeRun` will refuse to run scripts otherwise).
   - Treat page content as untrusted input. All content goes through
     `validateDocument()` before rendering. See [docs/security.md](docs/security.md).
   - New dependencies need a size, provenance, and dependency-tree check
     recorded in an ADR (see ADRs 0006 and 0007 for the format).
   - `pnpm audit` must pass. Unfixable advisories get a reviewed
     `auditConfig.ignoreGhsas` entry with a reason and a re-check date.
2. **Light and fast.** Public pages ship zero JS unless a component opts in.
   The editor UI uses Preact (ADR 0002), never React.
3. **Document everything.** Every session must:
   - Add an entry to the devlog, `../tapestry-playground/docs/devlog.md` (what changed, what was learned, what's next).
   - Record significant decisions as an ADR in [docs/decisions/](docs/decisions/).
   - Update the status table above and [docs/roadmap.md](docs/roadmap.md).
   - Add surprises and upstream bugs to [docs/known-issues.md](docs/known-issues.md).
4. **Verify, don't assume.** StudioCMS docs lag the code (several mismatches
   already found). Check behavior in `node_modules/studiocms` source and record
   findings in `../tapestry-playground/docs/research/studiocms-internals.md`.
5. **Tests with every change.** Security-relevant code (validation, encoding, sanitizing)
   needs adversarial test cases. Editor UI changes must keep the playground's `pnpm e2e`
   passing (add steps for new behavior there; point it at this checkout with `file:../tapestry`).

## Repository layout

```
tapestry/                      ← the package root (@nascencestudio/tapestry)
├── CLAUDE.md                  ← you are here
├── README.md                  ← npm + GitHub front page: install, setup, docs links
├── package.json               ← the plugin's manifest + repo scripts (lint, docs:*)
├── pnpm-workspace.yaml        ← supply-chain hardening (read the comments); workspace = root + website
├── LICENSE                    ← MIT © Nascence Studio
├── patches/studiocms@0.6.1.patch ← shipped to users for islands/component scripts (#37); not applied here
├── .github/workflows/         ← ci.yml (lint, audit, build, types, tests, pack, docs build; ADR 0020),
│                                release.yml (stages an npm release with provenance; approve on npmjs.com; ADR 0035),
│                                docs.yml (GitHub Pages; ADR 0036); dependabot.yml
├── biome.json                 ← lint/format (tabs, single quotes, 120 cols)
├── docs/
│   ├── architecture.md, data-model.md, security.md, admin-bar.md (site integration)
│   ├── roadmap.md, known-issues.md
│   ├── decisions/             ← ADRs
│   └── guides/                ← defining-components.md, development.md (contributing)
├── src/
│   ├── index.ts           ← plugin entry: tapestry(), tapestryComponentRegistry()
│   ├── types.ts           ← component definition + document types
│   ├── define.ts          ← defineComponent(), toManifest()
│   ├── validate.ts        ← parseDocument()/validateDocument(), limits, URL safety
│   ├── render.ts          ← document → <tapestry-node> HTML (+ <tapestry-slot> wrappers), splitSlots(), props encoding, sanitizer opts
│   ├── migrations.ts      ← format + component migrations, resolveType() for `replaces` (pure, ADR 0031)
│   ├── permissions.ts     ← component permissions: locked types, lockedChanges(), matchesSomeVersion() (pure, ADR 0033)
│   ├── patterns.ts        ← saved sections: limits, ids, names, build/parse/summarize (pure, ADR 0028)
│   ├── slots.ts           ← child areas (default + named slots), sortByArea(), canonicalNode() (pure)
│   ├── access.ts          ← pure rules: permissions, draft visibility, headers, page URLs, isExternal/resolvedLink
│   ├── revisions.ts       ← stored page format 2: published/draft/history, publish/restore (pure)
│   ├── public-content.ts  ← redacts unpublished Tapestry content from JSON (pure)
│   ├── resolve.ts         ← collectRefs(): media/link values at any level (props, objects, list items) (pure)
│   ├── richtext.ts        ← rich text format, cleanRichText() (toolbar allowlist), toRenderTree() (pure)
│   ├── toolbar-settings.ts← admin toolbar narrowing: parse/apply/form helpers (pure)
│   ├── translations.ts    ← languages option, translation rows/groups, new-translation slug/title/content (pure, ADR 0032)
│   ├── vite.ts            ← virtual modules: manifest, component imports, runtime config, thumbnails;
│   │                        islandWrapperSource() (index.ts writes them to node_modules/.tapestry/islands)
│   ├── virtual.d.ts       ← types for virtual:tapestry/*
│   ├── runtime/
│   │   ├── renderer.ts    ← StudioCMS PluginRenderer for the page type
│   │   ├── page.ts        ← getPage() for site routes (@nascencestudio/tapestry/page); picks published/draft
│   │   ├── viewer.ts      ← getViewer(): StudioCMS session check (re-exported from page.ts)
│   │   ├── middleware.ts  ← Astro middleware: JSON responses carry only published content for non-editors;
│   │   │                     publish-guard.ts guardSaves(): keeps the live version for non-publishers (ADR 0022), refuses changes to locked components (ADR 0033)
│   │   ├── AdminBar.astro ← zero-JS admin bar for editors (@nascencestudio/tapestry/AdminBar.astro)
│   │   ├── RichText.astro ← renders richtext values (@nascencestudio/tapestry/RichText.astro), no set:html; canvas text markers
│   │   ├── TapestrySettings.astro ← Plugins → Tapestry page (StudioCMS dashboard layout, sections in the inner sidebar)
│   │   ├── ToolbarSettings.astro, settings-endpoint.ts, toolbar-store.ts, settings-onsave.ts ← "Text formatting" form, POST /_tapestry/settings, plugin-data storage, settingsPage stub
│   │   ├── Root.astro     ← document wrapper (canvas root marker in canvas mode)
│   │   ├── Render.astro   ← POST /_tapestry/render: editors-only canvas renderer
│   │   ├── canvas-mode.ts ← per-request canvas flag + marker attribute names
│   │   ├── Node.astro     ← renders one node (wrapper swapped in by StudioCMS); resolves media and link props
│   │   ├── links.ts       ← resolveLinks(): page ids → current paths (drafts null for visitors) (ADR 0025)
│   │   ├── translations-endpoint.ts, translations-store.ts, languages.ts ← /_tapestry/translations (list, create), rows, getPage() language/translations + link localizing
│   │   ├── patterns-endpoint.ts, patterns-store.ts ← /_tapestry/patterns (editors; GET/POST/DELETE), plugin-data rows
│   │   ├── pages-endpoint.ts ← GET /_tapestry/pages: editors-only page list for the link field (routes.ts has the paths)
│   │   └── Editor.astro   ← hosts the editor + the page-content textarea
│   └── editor/            ← Preact dashboard editor (browser only)
│       ├── mount.tsx      ← entry: parse content, create store, sync textarea
│       ├── store.ts       ← signals: doc, selection, undo/redo
│       ├── tree.ts        ← pure immutable tree operations
│       ├── dnd.ts         ← Pragmatic DnD glue, shared activeDrag, applyDrop()
│       ├── canvas/        ← visual canvas: Canvas.tsx, controller.ts (iframe), scripts.ts (runs new component scripts once), geometry.ts + partial.ts (pure), inline.ts (on-canvas rich text), plain-text.ts (on-canvas plain text, ADR 0024)
│       ├── structure-keys.ts ← keyboard + clipboard commands shared by the layer tree and the canvas
│       ├── diff.ts        ← version differences (pure); ComparePanel.tsx, SchedulePanel.tsx
│       ├── library-previews.ts, LibraryPreview.tsx ← thumbnails + live previews in the library (ADR 0029)
│       ├── TranslationsMenu.tsx ← toolbar menu: language versions, create
│       ├── patterns-client.ts ← library list, save/delete, insertPattern() (fresh copies)
│       ├── publishing.ts  ← stored page signal, writes draft/publish into the textarea
│       ├── icons.tsx      ← toolbar + UI icons (inline SVG, drawn for Tapestry) and letter glyphs
│       ├── InfoPopover.tsx ← "i" button + closable help popover, ShortcutList, shortcutText()
│       ├── RichTextField.tsx, richtext-editor.tsx, richtext-schema.ts ← ProseMirror field, shared session/toolbar, per-toolbar schema (lazy chunk; richtext-loader.ts loads it)
│       ├── App.tsx, Library.tsx, Layers.tsx, PropsPanel.tsx (FieldRow), LinkField.tsx, StructuredFields.tsx (object/list), JsonView.tsx, HistoryPanel.tsx
│       └── editor.css     ← themed via StudioCMS CSS variables, container queries
├── scripts/copy-assets.mjs    ← copies .astro/.d.ts into dist/
├── test/                      ← Vitest suites
└── website/                   ← docs site (Starlight, ADR 0036): scripts/sync-docs.mjs generates pages from docs/ + README.md
```

## How it works (one paragraph)

The plugin registers page type `tapestry/canvas`. Its content is a JSON
`TapestryDocument` (a tree of `{ id, type, props, children }`). On render,
StudioCMS calls our `renderer(content)`, which parses and validates the
document against the component manifest and emits one
`<tapestry-node id="…" type="…" props="…">` element per node inside a
`<tapestry-root>`, with props as URL-encoded JSON. StudioCMS sanitizes that HTML
(only those two elements are allowed) and its component registry swaps them for
our `Root.astro` and `Node.astro`. `Node.astro` decodes the props and renders
the real Astro component imported from the `virtual:tapestry/components` module.

Site integration: public routes load pages with `getPage(Astro)` (enforces draft
visibility; never call `GET.page.bySlug` directly) and render `<AdminBar>` for
logged-in editors (zero JS, nothing for anonymous visitors). See [docs/admin-bar.md](docs/admin-bar.md).

Canvas: the editor shows the page's real URL in an iframe with `?tapestry-canvas`
(editors only → markers via `Astro.locals`) and swaps in fresh renders from
`POST /_tapestry/render` on each edit. See ADR 0010.

Editing: `Editor.astro` mounts a Preact app (dashboard only, ~35 KB gzipped on first load; the
ProseMirror rich text field, ~67 KB, is a lazy chunk)
that keeps the document in a signals store, edits it with pure tree operations,
and writes the stored page into StudioCMS's `page-content` textarea after the first
edit, so StudioCMS's own Save persists it. Details: [docs/architecture.md](docs/architecture.md).

Publishing (ADR 0011): stored content is `{ version: 2, published, draft, history }`.
Save stores a draft, **Publish** moves the live version into history (5 kept) and
submits. Visitors only ever get `published` (renderer, `getPage()`, and a plugin
middleware that redacts StudioCMS's JSON/REST responses). Editors preview drafts
with `?tapestry-preview`.

Named slots (ADR 0027): children carry `slot` (grouped by area in one array); the renderer wraps
slot children in `<tapestry-slot>` and `Node.astro` splits them into real Astro named slots
(StudioCMS's registry only passes a default slot).

Lists and objects (ADR 0026): `list` props are repeaters (arrays of objects), `object` props group
fields; both use the single-value types as fields and are cleaned field by field.

Links (ADR 0025): `link` props store a page id or a web address; `Node.astro` resolves them
to `ResolvedLink | null` (current path, `rel` for new tabs; drafts hidden from visitors).

Rich text (ADR 0012): `richtext` props store a ProseMirror-shaped JSON tree, cleaned
by `cleanRichText()` against the prop's `toolbar` (the allowlist) and rendered by
`RichText.astro` from allowlisted elements. Rich text is also editable directly on the
canvas: selecting a component makes it editable, toolbar under the chip (ADR 0013). Admins can
narrow toolbars in Dashboard → Plugins → Tapestry → Text formatting (ADR 0014; editing only, the
developer's toolbar is the ceiling).

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install (supply-chain policies are enforced) |
| `pnpm build` | Build to `dist/` (what sites and the playground use) |
| `pnpm dev` | Rebuild on change (tsc watch; re-run `build` for .astro changes) |
| `pnpm test` / `pnpm test:watch` | Unit tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm format` | Biome |
| `pnpm audit` | Known vulnerabilities |
| `pnpm pack --dry-run --ignore-scripts` | What would be published (dist/, the patch, README, LICENSE) |
| `pnpm docs:dev` / `pnpm docs:build` | Docs site (synced from `docs/`; `DOCS_BASE`, `REPO_URL` env for GitHub Pages) |

Dev site, e2e (`pnpm e2e`), budget and Docker: see `../tapestry-playground/CLAUDE.md`. To test this
checkout there: its `@nascencestudio/tapestry` dependency = `file:../tapestry`, then after each
`pnpm build` here run `pnpm install` there (a `file:` dependency is a copy) and restart its dev server.

## Pinned stack (2026-10-09; the playground's own site dependencies are in its CLAUDE.md)

| Package | Version | Note |
| --- | --- | --- |
| Node | ≥ 22.12 (dev: 22.23.3) | `.nvmrc`; 22.23.x has the 2026 security releases |
| pnpm | 12.4.2 | `packageManager` field |
| astro | 7.3.5 | |
| studiocms | 0.6.1 | |
| @libsql/client | 0.18.0 | dev dependency; matches StudioCMS 0.6.1's database layer |
| typescript | 6.0.3 | not 7: `@astrojs/check` (playground) supports ≤ 6; keep the repos aligned |
| vitest | 5.0.3 | pins `why-is-node-running@3.2.1` itself |
| @astrojs/starlight | 0.42.5 | docs site only (ADR 0036); `postcss-nested` override for an audit fix |
| @biomejs/biome | 2.5.14 | |
| preact | 10.29.8 | not 11: `@astrojs/preact@6` peer is `^10.6.5` (we don't use the integration, but stay compatible) |
| @preact/signals | 2.11.2 | |
| @atlaskit/pragmatic-drag-and-drop | 4.0.0 | + `-hitbox` 3.0.0; no provenance (ADR 0007) |
| prosemirror-* | model 1.25.12, state 1.4.4, view 1.42.6, transform 1.12.2, commands 1.7.2, keymap 1.2.3, history 1.5.1, schema-list 1.5.1 | rich text editor; no provenance; no Meta libraries (user preference) (ADR 0012) |

## Conventions

- TypeScript strict, ESM only, `.js` extensions in relative imports (NodeNext).
- Biome formatting: tabs, single quotes, 120-column lines. Run `pnpm format`.
- Component `type`s are kebab-case (`hero`, `card-grid`). Prop names are
  camelCase identifiers. Names starting with `on`, plus `class`, `style`, `id`,
  `slot`, and similar, are rejected (see `define.ts`).
- Public API changes go in `src/index.ts` exports and get documented in
  [docs/guides/defining-components.md](docs/guides/defining-components.md).
- The plugin consumes its own build output (`dist/`), so rebuild after changes.

## Gotchas learned the hard way

(Browser-test, dev-site and Docker gotchas are in the playground's CLAUDE.md.)

- StudioCMS's HTML pipeline (ultrahtml) passes attribute values to components
  **without decoding HTML entities**, hence the URL-encoded props (ADR 0004).
- ultrahtml's `allowAttributes` does **not** strip unlisted attributes; only
  `allowElements` is a real allowlist. The validator is the attribute guard.
- `studiocmsMinimumVersion` no longer exists on `definePlugin` (docs are outdated).
  The hook name is `studiocms:astro-config`.
- StudioCMS plugins can't add `componentRegistry` entries, so users must spread
  `tapestryComponentRegistry()` into their config (one line).
- Production builds need `vite.build.cssMinify: 'esbuild'` because of a StudioCMS
  CSS bug (see [known issues](docs/known-issues.md)).
- New StudioCMS pages show their content editor only after the page is created
  (create first, then edit), and the editor sits on the **Page Content** tab.
- StudioCMS saves any unknown **named** form field as plugin data, so editor
  controls must never have `name` attributes; buttons must be `type="button"`;
  Enter in inputs is suppressed (it would submit, which saves the page).
- Opacity-hidden buttons are still clickable: hide interactive things with
  `visibility`/`display`, not `opacity`.
- `SDKCoreJs.GET.page.bySlug()` returns **drafts**. Public routes must use `getPage()`.
- StudioCMS only resolves the session on dashboard/API routes. On public routes use
  `getViewer()` (wraps `User.getUserData()` from `studiocms:auth/lib`).
- StudioCMS feature flags live under `features` (e.g. `features.injectQuickActionsMenu`).
  Unknown top-level config keys are **silently ignored**, so verify that options take effect.
- Astro bundles a component's CSS whenever it's imported. For output that must not
  reach anonymous visitors, emit CSS inline inside the same conditional as the markup.
- `all: initial` on `X *` also applies to `<style>` children (they become visible), so
  keep `<style>` outside the styled container.
- The render endpoint's **dev** output contains Astro `<style>` tags inside the
  content root; the canvas strips page-level tags when swapping (else dashboard CSS
  leaks into the site preview).
- `all: unset` resets `-webkit-user-drag`; restore it on anything `draggable`.
- **Never modify a drag source during `dragstart`** (styles, class, visibility).
  Chrome aborts the drag. Defer visual changes with `setTimeout(0)`.
- `Astro.locals` set by the page is visible inside registry-rendered components.
- StudioCMS has **no built-in page types**; Markdown/HTML/WYSIWYG are plugins. Its
  create form hard-codes the Markdown default, so keep `@studiocms/md` installed.
- Dependency fixes go through `pnpm patch <pkg>@<ver>` + `pnpm patch-commit` →
  `patches/` + `patchedDependencies` (with a reason and exit condition in
  `pnpm-workspace.yaml`). pnpm fails the install if a patch stops applying.
- Browser deps used by the editor must be listed in `EDITOR_DEPS` (`index.ts`),
  or Vite reloads the page on the first editor visit in dev.
- Keep site CSS scoped (`.site` on `<body>`, `--site-*` variables). The dev leak that made
  this necessary (#14) is fixed by the Astro patch, but scoping is still good practice.
- Sites need their own `src/pages/404.astro` **and** `features.dashboardConfig.inject404Route: false`;
  StudioCMS's 404 renders the whole dashboard layout for visitors (#34).
- Editor inputs with constraints (`min`, `max`, `step`, `required`) sit inside StudioCMS's page
  form: an invalid value silently blocks Save. Detach them with `form="tapestry-detached"` (#36).
- Node `label`s are editor-only; the canvas sends documents to the render endpoint without them
  (`renderJson`), so renaming doesn't re-render. Only node-level `label` keys: props may be named "label".
- Publishing checks happen on the server (publish-guard.ts) and readers apply due schedules
  (`applyDueSchedule`); never add a reader of stored content that skips either.
- Never import CSS from **browser** code in plugin packages: Astro's script-to-page mapping
  crosses the manifest, so the CSS lands on every page. Import component CSS server-side (in
  the `.astro` frontmatter) or load it on demand (`?url` + `<link>`, see medialibrary `ui/styles.ts`).
- Admin bar styles must stay ID-anchored (`#tapestry-adminbar`); class selectors
  lose to common site rules like `.site a`.
- Tapestry content is a **stored page** (format 2). In tests, read the editor's document
  with `working(page)` / `parseStored()` (e2e helpers), not `JSON.parse(field).root`.
- Never mutate page objects from the SDK: they're cached across requests. Copy them
  (`getPage()` does), or a draft can leak to the next visitor.
- StudioCMS's public REST API returns raw stored content; our middleware redacts it.
  Anything new that serves stored content to non-editors must go through `documentFor()`
  or `redactDrafts()`.
- Rich text JSON must match ProseMirror's `toJSON()` byte for byte (key order
  `{ type, marks, text }`): documents are compared as strings.
  Editor output goes through `stripDefaultAttrs()` (ProseMirror writes `textAlign: null`).
- Admin toolbar settings store *turned-off* buttons (format 2), so new developer buttons
  appear by default. Don't switch back to an enabled-list.
- Toolbar menus (text style, alignment) are menu buttons, not `<select>`s; in e2e open
  them with a click on `[data-tapestry-format="heading|align"]` and pick
  `[data-tapestry-menu-item="…"]`; the current value is the button's `data-value`.
  CDP `Input.dispatchKeyEvent` Enter doesn't "click" buttons, so handle Enter/Space
  explicitly on custom controls.
- Sync outside values into ProseMirror (or any stateful widget) with `useLayoutEffect`,
  not `useEffect`: Preact runs passive effects after paint, so fast input can race them.
- Rich text components use `<RichText value={…} />` and style its output with `:global()`.
- Python/sed edits that don't `assert` the old text exists can silently do nothing
  (a config edit was lost this way); check, or use the Edit tool.
- StudioCMS `usePluginData()` insert/update don't persist in 0.6.1 (known issue #25); use
  `SDKCoreJs.dbService.db` (Kysely) like `toolbar-store.ts`.
- Plugin dashboard pages (`dashboardPages`) appear under Admin, not Plugins. The Plugins section
  lists only plugins with a `settingsPage`, linking to `/dashboard/plugins@<id>` (missing slash,
  #27). Tapestry serves its own page there with `studiocms/frontend/layouts/DashboardLayout.astro`.
- `requiredPermissions: 'none'` / `x-required-role: 'none'` = **no authentication**. Never use it
  to hide a page.
- StudioCMS's double sidebar needs `#back-to-outer` and `#show-page` in the inner sidebar.
- StudioCMS CSS variables (`--primary-base`, `--border`) are complete colors; use
  `var(--primary-base)`, not `hsl(var(...))`.
- Inline canvas editing: typing commits are flagged (`inline.isCommitting()`) and don't
  re-render; other changes re-render and `suspend()`/`resume()` the editor. e2e waits on
  `data-tapestry-editing`, and on focus before typing into the in-canvas link field.
  Events in the canvas: check `event.defaultPrevented` (ProseMirror handled it) before
  acting on keys like Escape.
- Count *all* chunks an entry imports when reporting bundle sizes (a shared chunk was
  missed once).
- Media: content stores media **ids** (`m_` + 16 base-36); `Node.astro` resolves `media`
  props to items; never store file URLs in content. Upload types come from file bytes
  (`detect.ts`), never the name alone. Test fixtures for every format (generated with
  sharp/ffmpeg) live in the medialibrary repo; the playground's e2e suites use copies in `e2e/fixtures`.
- Tapestry ↔ media library: build-time virtual modules (`virtual:tapestry/media`,
  `virtual:tapestry/media-client`); the editor gets the picker loader via `mountEditor`
  (keep virtual imports out of modules unit tests load). The media library is an optional peer of Tapestry.
- Routes whose first segment is a parameter lose to StudioCMS's `/dashboard/[...pluginPage]`
  once any plugin has a dashboard page; register literal `/dashboard/...` paths too (#28).
- Plugin middleware entrypoints must be filesystem paths (`fileURLToPath`), not `file:` URLs.
- Chrome gives focus back to an editable drag source when a drag ends (after `drop`), so a
  component dragged by its plain text kept the text focused and Ctrl+Z went to the browser.
  The canvas blurs editable text on `dragend`.
- Docs: edit `docs/` (and README.md), never `website/src/content/docs/` (generated). New docs
  pages to publish go in the `pages` list in `website/scripts/sync-docs.mjs`.
- Accessibility: new editor UI states belong in `e2e/a11y.e2e.mjs`. StudioCMS's success/warning/
  danger colors are background colors: don't use them as text (status pills use a border + dot;
  `--tp-danger` is Tapestry's own text-safe red per theme).
- Component permissions: one rule (`permissions.ts`) for editor and server. New save paths must go
  through `guardSaves()`; new editing paths through `store.commit` (which enforces locks).
  Toolbar: keep status pills last, so their changing width never moves buttons.
- Translations are separate pages (rows `{ lang, source }` in plugin data). Anything that lists
  or links translations for visitors must check visibility (published, not a StudioCMS draft) like
  `languages.ts`; never expose an unpublished translation's slug.
- Component migrations run inside `validateDocument()` (every reader). The manifest carries
  `migrate` functions at runtime (generated module), so never JSON-serialize the manifest.
  Node `version` is written only when above 1; document format 2 is reserved (stored page wrapper).
- StudioCMS drops every `<script>` from rendered page content (#37); our patch keeps them for
  renderers with `componentScripts: true` (Tapestry). Don't remove that flag: islands and component
  scripts would silently stop working. Content still can't add scripts (validated JSON).
- Islands: Astro only hydrates statically imported components with a literal `client:*`, hence the
  generated wrappers. The canvas runs each new script once; clicks there still select.
- Keyboard hints live in `InfoPopover`s; keep a visually hidden `aria-describedby` copy
  (`shortcutText()`) for screen readers. The Components panel uses the fixed `--tp-brand` purple.
- Library previews render through the render endpoint into a `sandbox="allow-same-origin"` srcdoc
  frame with the canvas page's stylesheets; no canvas loaded → no preview. `thumbnail` paths are
  build-time only (stripped from the manifest; URLs via `virtual:tapestry/thumbnails`).
- Patterns are copies (fresh ids via `freshCopies()`); the library list has no components, they're
  fetched on insert. Drag type `pattern` is handled in `applyDrop()` asynchronously.
- Named slots: keep children grouped by area (`sortByArea`) and nodes in canonical key order
  (`canonicalNode`: id, type, label, slot, props, children) in every tree operation. Move targets
  carry `slot`; a move that only changes the slot is valid.
- List/object props: fields are single-value types only (one level). Values without their
  definition are ambiguous (an object field set can look like a link), so pass the definition
  (`displayValue(value, def)`). Nested editor ids use `__` (`…-items__2__question`).
- Link props: components get `ResolvedLink | null`, never the stored value. Anything new that
  shows page links must hide draft pages from visitors like `resolveLinks()`.
- Published packages must not have `"private": true` (pnpm refuses to publish; the first release
  failed on it). Only `website` is private. A release tag
  points at the commit it was created on: after fixing code, make a new release/tag (after fixing
  only npm/GitHub settings, re-run the job). npm answers **404** to an unauthorized publish of a new
  scoped package (token scope/permissions). New packages first show a `0.0.0-stage` stub until npm's
  automated check releases the real version (staged publishing). The first publish needs a token;
  trusted publishing can only be set up once the package exists.
- Pragmatic DnD 4.x import paths: `@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter`,
  `/utils/combine`, hitbox `/list-item/attach-instruction` and `/list-item/extract-instruction`.
