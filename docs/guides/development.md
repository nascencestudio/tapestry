# Development setup

## Prerequisites

- Node ≥ 22.12 (`.nvmrc` says 22)
- pnpm ≥ 12 (`corepack enable` or install pnpm directly). **Never use npm or yarn here.**

## First-time setup

```sh
# 1. Install. Supply-chain policies run automatically; see docs/security.md.
pnpm install

# 2. Build the plugin (the playground consumes packages/tapestry/dist).
pnpm --filter @nascencestudio/tapestry build

# 3. Create the playground env file with a fresh encryption key.
cd playground
cp .env.example .env
# put the output of `openssl rand --base64 16` into CMS_ENCRYPTION_KEY
chmod 600 .env

# 4. Create the database schema (local SQLite file: playground/studiocms.db).
pnpm migrate

# 5. Start the dev server (Astro 7 runs it as a background daemon).
pnpm dev
```

For a **fresh database**, also complete StudioCMS's first-time setup. The setup routes
exist only while the dev server runs with `CMS_SETUP=1`:

```sh
CMS_SETUP=1 pnpm dev
node scripts/setup-site.mjs     # creates the site and owner "tapestry-dev", writes .dev-credentials
pnpm exec astro dev stop && pnpm dev
```

(Or open http://localhost:4321/start while `CMS_SETUP=1` and fill in the wizard;
common usernames like `admin` are rejected.) CI does the same (ADR 0020).

Then seed the demo page and open the site:

```sh
pnpm seed          # creates/resets the "index" Tapestry page
open http://localhost:4321/
open http://localhost:4321/dashboard
```

The existing local dev login is in `playground/.dev-credentials` (gitignored).

## Daily workflow

| Task | Command |
| --- | --- |
| Rebuild the plugin on change | `pnpm --filter @nascencestudio/tapestry dev` (tsc watch). `.astro` changes need `build`. |
| Run tests | `pnpm test` (or `pnpm --filter @nascencestudio/tapestry test:watch`) |
| Type-check everything | `pnpm typecheck` |
| Lint / format | `pnpm lint` / `pnpm format` |
| Dev server status / logs / stop | `pnpm --filter playground exec astro dev status` (or `logs`, `stop`) |
| Production build + run | `pnpm build`, then in `playground/`: `set -a; . ./.env; set +a; node dist/server/entry.mjs` |
| Security audit | `pnpm audit` |
| Browser e2e (dev server must be running) | `pnpm e2e` (`HEADED=1` to watch, `E2E_SCREENSHOTS=/some/dir` for screenshots) |
| Performance budget (production server) | `pnpm build`, then in `playground/`: `PORT=4600 node dist/server/entry.mjs` (with the `.env` loaded), then `BASE_URL=http://localhost:4600 pnpm budget` |

## Page types in the playground

StudioCMS has no page types of its own; each comes from a plugin. The playground
registers **Markdown** (the official StudioCMS plugin, also the create form's
hard-coded default) and **Tapestry**. Both render through the same `getPage()` route
and get the admin bar. Only Tapestry pages have the visual canvas. The HTML and
WYSIWYG plugins were tried and removed (HTML: used only as a reference, needed a local
patch to save; WYSIWYG: security advisories, broken rendering).

## Media library

The playground registers `@nascencestudio/medialibrary`. Dashboard → **Media** lists
uploads (stored in `playground/data/media`, gitignored); the Hero component's
"Background image" and the Text toolbar's "Insert media" button open the same library
as a picker. Supported files and limits: [the media library README](https://github.com/nascencestudio/medialibrary).
For production, see [deployment.md](deployment.md).

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
     Switch Desktop / Tablet / Mobile widths. **⤢ Full screen** gives a Canvas-style
     workspace with its own **Save draft** button (or Ctrl/⌘+S).
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

`pnpm e2e` drives headless Chrome over the DevTools protocol (no extra
dependencies; see ADR 0008). It needs the dev server on :4321 and a completed
StudioCMS setup; it logs in with `playground/.dev-credentials` (or
`TAPESTRY_E2E_USER` / `TAPESTRY_E2E_PASSWORD`). It resets the demo home page
through the editor before and after, so it's safe to re-run. Set `CHROME_PATH`
if Chrome isn't in the default location.

## Adding a dependency

```sh
pnpm --filter <package> add <dep>          # exact version saved automatically
```

If the install fails a supply-chain check, **investigate, don't bypass**:
check `pnpm view <pkg> time` and the provenance (`dist.attestations`), then
document any exception in `pnpm-workspace.yaml` (inline reason) and the devlog.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN` | `package.json` changed. Run `pnpm install`. |
| `ERR_PNPM_IGNORED_BUILDS` | A new dependency wants an install script. Decide, then add it to `allowBuilds` (true or false) with a comment. |
| Trust downgrade error | See ADR 0003; check provenance history before adding any exception. |
| `Unknown at rule: @keyframes` in build | StudioCMS CSS bug. Keep `cssMinify: 'esbuild'` in `astro.config.mjs`. |
| Playground doesn't reflect plugin changes | Rebuild the plugin (`dist/` is what's consumed). |
| `No rendering plugins found` | StudioCMS needs at least one page-type plugin; Tapestry counts. |
| `pnpm seed` changes don't show | StudioCMS caches pages for 5 minutes. Restart the dev server, or edit through the dashboard. |
| Dashboard looks wrong in light mode (dark background, invisible text) in dev | Unscoped site CSS leaking into the dashboard (known issue #14). Scope site styles; see "Site CSS and the StudioCMS dashboard" in the defining-components guide. Restart the dev server. |
| Canvas says the route "doesn't support the canvas" | The site's page route must load pages with `getPage()` (see docs/admin-bar.md). |
| Canvas stays blank | The dashboard must be allowed to frame the site: same origin, no `X-Frame-Options: DENY` or `frame-ancestors 'none'` for editors. |
| Editor shows the old UI after plugin changes | Rebuild the plugin, then restart the dev server (`astro dev stop`, `pnpm dev`) so Vite picks up the new `dist/`. |
