# Contributing and development

Tapestry is developed in two repositories, checked out side by side:

| Repository | Contents |
| --- | --- |
| [nascencestudio/tapestry](https://github.com/nascencestudio/tapestry) (this one) | The plugin (`src/`, unit tests in `test/`), its docs and the docs site (`website/`) |
| [nascencestudio/tapestry-playground](https://github.com/nascencestudio/tapestry-playground) | An Astro + StudioCMS site using the plugin: browser (e2e) tests, performance budget, Docker deployment, devlog |

The media library is a third repository, [nascencestudio/medialibrary](https://github.com/nascencestudio/medialibrary).

## Prerequisites

- Node ≥ 22.12 (`.nvmrc`)
- pnpm ≥ 12 (`corepack enable`). **Never use npm or yarn here.**

## The plugin

```sh
pnpm install       # supply-chain policies run automatically (docs/security.md)
pnpm build         # dist/ (what sites and the playground use)
pnpm dev           # rebuild on change (tsc watch; .astro changes need `pnpm build`)
pnpm test          # unit tests (Vitest); `pnpm test:watch` while working
pnpm typecheck
pnpm lint          # Biome; `pnpm format` to fix formatting
pnpm audit
pnpm docs:dev      # the docs site (generated from docs/ and README.md)
```

## Trying changes in the playground

```sh
git clone https://github.com/nascencestudio/tapestry-playground.git   # next to this repo
```

The playground normally installs Tapestry from npm. To run it against your local checkout,
point its dependency at this folder, `"@nascencestudio/tapestry": "file:../tapestry"`, and
run `pnpm install` there. After `pnpm build` here, run `pnpm install` in the playground again
(a `file:` dependency is a copy) and restart its dev server. Setup, the demo page, browser tests
and the performance budget are described in the playground's README.

## Editing a Tapestry page

1. Dashboard → Content → create a page with type **Tapestry (visual builder)**.
2. Save it, then open it again and go to the **Page Content** tab. StudioCMS shows
   page-type editors only on the edit screen.
3. Build the page. The **canvas** in the middle (or at the top, if the editor is
   narrow) is the real page, updating as you edit:
   - **Canvas**: click a component to select it; hover to see outlines; **drag any
     component on the page to move it** (a selected container moves as a whole, even
     if you grab it by a child); drag components from the library straight onto the
     page; or use the selection chip (⋮⋮ drag, ⧉ duplicate, ✕ delete). Links don't navigate in the canvas.
     Switch Desktop / Tablet / Mobile widths; the button next to them is **full screen**, a
     Canvas-style workspace. The purple bar above the canvas holds undo/redo, the language
     menu, **History** and **JSON**; the canvas bar has reload and **View page**; the bar under
     the canvas has the keyboard help and **Save draft** (or Ctrl/⌘+S), **Schedule…**, **Publish**.
     **History** and **JSON** open in a dialog (Escape or ✕ closes it).
   - **Add**: click a component in the library (it goes inside the selected
     container, after the selected component, or at the end), or drag it into the
     page structure.
   - **Arrange**: drag rows. The top or bottom of a row inserts above or below; the
     middle of a container row puts it inside.
   - **Configure**: select a row and edit its settings on the right. Rich text fields
     (like the Text component's Body) have a formatting toolbar: Ctrl/⌘+B / I / U,
     Ctrl/⌘+K for a link, Shift+Enter for a line break, Ctrl/⌘+[ and ] to outdent or
     indent list items, Ctrl/⌘+\ to remove formatting, Ctrl/⌘+, and Ctrl/⌘+. for
     sub/superscript, Ctrl/⌘+Alt+1–6 for headings (Ctrl/⌘+Alt+0 for a paragraph). Text
     style (P, H1–H6) and alignment are menu buttons whose icon shows the current setting. Pasted text keeps only the
     formatting the toolbar offers.
   - **Edit text on the page**: click rich text on the canvas and type; selecting a
     component (on the canvas or in the page structure) makes its text editable right
     away. The formatting toolbar appears under the component's chip. Escape stops
     editing (click the text to continue); selecting something else ends it. The
     settings panel points to the canvas, with **Edit here instead** if you prefer the panel.
   - **Admins** choose which buttons each rich text field gets under Dashboard →
     Plugins → **Tapestry** → **Text formatting**.
   - **Keyboard**: ↑/↓ select · Alt+↑/↓ move · Alt+→ into the previous container ·
     Alt+← out of the container · Delete · Ctrl/⌘+D duplicate · Ctrl/⌘+Z / Ctrl/⌘+Shift+Z.
   - **JSON**: the `{ } JSON` button shows the raw document; Apply validates it first.
4. Save and publish ([ADR 0011](../decisions/0011-draft-publish-history.md)):
   - **Save draft** (or StudioCMS's **Save Changes**, or Ctrl/⌘+S) stores your edits
     as a **draft**. Visitors keep seeing the published version. Nothing is written
     until you edit something.
   - **Publish** makes the current version live. The status pill shows
     *Not published yet*, *Published* or *Unpublished changes*.
   - **History (n)** lists the live version and the 5 previous published versions.
     **Restore to draft** loads one into the editor (it goes live only when you
     publish). **Discard unpublished changes** goes back to the live version. Both
     can be undone with Ctrl/⌘+Z.
   - On the site, the admin bar shows the same status. **Preview draft** opens the
     page with your unpublished changes (`?tapestry-preview`, editors only).
   - A page that has never been published is a 404 for visitors.
   - Don't use StudioCMS's **Edit History** tab to revert Tapestry pages: it rolls
     back the live version too (known issue #21).

   Pages saved before drafts existed count as published. Their next save converts
   them, and from then on edits wait for **Publish**.

## Browser e2e tests

The browser suites live in the playground (`pnpm e2e` there, ADR 0008). Editor UI changes
must keep them passing, and new behavior gets new steps.

## Adding a dependency

```sh
pnpm add <dep>          # exact version saved automatically (-D for dev dependencies)
```

If the install fails a supply-chain check, **investigate, don't bypass**:
check `pnpm view <pkg> time` and the provenance (`dist.attestations`), then
document any exception in `pnpm-workspace.yaml` (inline reason), an ADR, and the devlog.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` | `package.json` changed. Run `pnpm install`. |
| `ERR_PNPM_IGNORED_BUILDS` | A new dependency wants an install script. Decide, then add it to `allowBuilds` (true or false) with a comment. |
| Trust downgrade error | See ADR 0003; check provenance history before adding any exception. |
| `Unknown at rule: @keyframes` in build | StudioCMS CSS bug. Keep `cssMinify: 'esbuild'` in `astro.config.mjs`. |
| Playground doesn't reflect plugin changes | Rebuild the plugin (`dist/` is what's consumed), run `pnpm install` in the playground (its `file:` copy), restart its dev server. |
| `No rendering plugins found` | StudioCMS needs at least one page-type plugin; Tapestry counts. |
| `pnpm seed` changes don't show | StudioCMS caches pages for 5 minutes. Restart the dev server, or edit through the dashboard. |
| Dashboard looks wrong in light mode (dark background, invisible text) in dev | Unscoped site CSS leaking into the dashboard (known issue #14). Scope site styles; see "Site CSS and the StudioCMS dashboard" in the defining-components guide. Restart the dev server. |
| Canvas says the route "doesn't support the canvas" | The site's page route must load pages with `getPage()` (see docs/admin-bar.md). |
| Canvas stays blank | The dashboard must be allowed to frame the site: same origin, no `X-Frame-Options: DENY` or `frame-ancestors 'none'` for editors. |
| Editor shows the old UI after plugin changes | Rebuild the plugin, then restart the dev server (`astro dev stop`, `pnpm dev`) so Vite picks up the new `dist/`. |
