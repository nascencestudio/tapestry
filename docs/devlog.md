# Devlog

Chronological log of work sessions, newest first. Each entry covers what
changed, what we learned, and what's next. Keep entries factual. Link to ADRs
and known issues instead of repeating them.

---

## 2026-10-09: Session 23: Media library 0.1.0 released; Tapestry uses it from npm

**Request:** help with the first media library release (the user ran it), then switch over.

### Done
- Release fixes: `"private": true` removed from both published packages (pnpm refused to publish).
- `@nascencestudio/medialibrary` 0.1.0 is on npm: 173 files, SLSA v1 provenance, linked to its repo.
- `file:` dependencies replaced with `0.1.0` (playground, Tapestry devDependency). Verified: build,
  lint, typecheck, 406 unit tests, audit (1 reviewed ignore), production build, full e2e (23 suites).

### Learned
- GitHub refuses pushes whose commits expose a private email: commit with the no-reply address.
- A release tag stays on the commit it was created on; re-running the workflow doesn't pick up
  later commits. Fix code → new release; fix settings only → re-run.
- npm answers 404 when a token can't publish a new scoped package. The first publish needs a
  token (trusted publishing is configured per existing package).
- npm stages new packages: a `0.0.0-stage` stub is `latest` until an automated check releases
  the real version.

- **Staged releases** (ADR 0035 update): npm's trusted publisher allows "stage" by default and warns
  against allowing direct publish; a direct publish through it failed with 403 "OIDC permission
  denied for this action". Both release workflows now run `pnpm stage publish --provenance`
  (dry runs pass); a maintainer approves each version on npmjs.com with 2FA.

- medialibrary **0.1.1** released the intended way: staged by `GitHub Actions` through the trusted
  publisher (no token), approved by the maintainer with 2FA, SLSA provenance. Package publishing
  access is now "require 2FA, disallow bypass tokens". Tapestry and the playground use 0.1.1
  (typecheck, 406 unit tests, audit, the four media e2e suites pass). The tarball returned 404 for
  ~4 minutes after approval while metadata was already visible: retry installs, don't debug.

### Next
1. Tapestry's first release (bypass token once), then trusted publisher (stage only), publishing
   access option 1, delete the token + secret, and remove `NODE_AUTH_TOKEN` from release.yml.
2. Tapestry: git init, push, Pages, token for the first release, `v0.1.0`, then trusted publisher.
3. File the StudioCMS issue (docs/upstream/). Don't merge Dependabot's TypeScript 7 PR.

---

## 2026-10-08: Session 22: Repositories, media library moved out

**Request:** the GitHub repositories are `nascencestudio/tapestry` and
`nascencestudio/medialibrary`; the user chose to move the media library out of this monorepo.

### Done
- `repository`, `homepage` and `bugs` in `packages/tapestry/package.json`; README links point to GitHub.
- **Media library moved** to `../medialibrary` (its own repo, `git init -b main`, nothing pushed;
  [ADR 0037](decisions/0037-media-library-repository.md)): sources, tests and fixtures, its own
  `pnpm-workspace.yaml` hardening, CI + release workflows (provenance), Dependabot, CLAUDE.md,
  devlog and copies of ADRs 0003/0016/0018/0019. There: build, 174 tests, typecheck, lint, audit pass.
- Here: `packages/medialibrary` removed; the playground and Tapestry's devDependency use
  `file:../medialibrary` until 0.1.0 is on npm; media e2e fixtures copied to
  `playground/e2e/fixtures`; CI, release workflow and Dockerfile build Tapestry + playground only;
  `minimumReleaseAgeExclude` for our own package.
- Audit: http-cache-semantics is now 4.3.0, so its ignore entry is gone (known issue #8).

### Learned
- pnpm resolves an optional peer from the registry when nothing in the workspace provides it,
  so Tapestry needs a dev dependency on the media library for its own tests and types.
- `file:` installs a copy and dedupes its dependencies; `link:` keeps the other repo's
  `node_modules` (two Preacts).
- A dev server running for many hours kept serving the deleted workspace package; restart after
  moving packages.

### Verified
- Lint, typecheck, 406 unit tests, the docs site build, `pnpm audit` (1 reviewed ignore), and the
  full e2e run (23 suites, 199 steps) against the `file:` dependency.

### Next
1. Release order (the user): medialibrary v0.1.0 → switch `file:` to `0.1.0` here + `pnpm install`
   → push, Pages, trusted publishing, tapestry v0.1.0 → file the StudioCMS issue (docs/upstream/).
2. Re-check the braces advisory on 2026-11-01.

---

## 2026-10-08: Session 21: Phase 5: permissions, accessibility, performance budget, release prep, docs site

**Request:** continue the Phase 5 items.

### Done
- **Component permissions** ([ADR 0033](decisions/0033-component-permissions.md)): `permission:
  'admin' | 'owner'` on a definition locks it for lower roles. One rule in `permissions.ts` (a
  saved document must leave locked components as in some version the page already has), used
  by the editor store (refuses commits; a visible notice explains) and the server
  (`guardSaves()`, the former publish guard: 403 for crafted changes). UI: locks in the library
  and page structure, read-only settings (disabled fieldset, read-only rich text), no canvas
  drag/duplicate/delete/inline editing for locked components. Playground: the Hero is admin-only.
- **Toolbar:** the status pills moved to the end. Their width changes (Published / Unpublished
  changes), and with the new language button the toolbar wraps, so Publish moved under the
  pointer between measuring and clicking (a full-run e2e failure in the publishing suite).
- e2e: media-extras' `clickAt` waits for a loaded, on-screen, still image (one flaky run).
- **Accessibility audit** ([ADR 0034](decisions/0034-accessibility-and-performance.md)): axe-core 4.13.0
  (dev dependency, reviewed) in a new `a11y` suite: the public page, and the editor in many states
  and both themes, plus the media library page. Fixed: heading outline (hidden `<h2>`), status pill
  contrast (text color + colored border/dot), a theme-aware danger text color, the media library's
  primary button contrast, reduced motion.
- **Performance budget**: `pnpm budget` measures what visitors download from a production server
  (home: 1.3 KB HTML, 1.5 KB CSS, 0.2 KB JS, 3 requests; one-island page: 8 KB JS) against
  `perf-budget.json`; CI runs it after the e2e suites.

### Learned
- A layout that shifts when a status changes is both a UX wobble and an e2e flake; the
  screenshot on failure showed it directly.

- axe found only one rule in the default dark theme (heading order); the light theme and an error
  state found the contrast problems. Auditing several states and both themes matters.

### Verified
- Unit: Tapestry 406 (+14), media library 174. Lint and typecheck clean.
- Full e2e: 23 suites, 199 steps (permissions +1, a11y 4). `pnpm budget` within budget.

### Publishing readiness (dry run, nothing published)
- `pnpm pack` works for both packages (tapestry 268 KB, medialibrary 100 KB; only `dist/` and
  `package.json`; workspace versions resolved).
- Missing before a release: `repository`, `homepage`, `author`, `engines`, `publishConfig`
  (public, provenance), a README and LICENSE file per package (MIT is declared, no license text
  or copyright holder). Provenance needs publishing from GitHub Actions (trusted publishing), so
  the repo must be on GitHub.
- Caveat: islands and component scripts rely on our StudioCMS patch (#37); sites installing from
  npm won't have it unless they apply it too, or StudioCMS fixes it upstream.

### Release preparation (user decisions: MIT © Nascence Studio, provenance from GitHub Actions,
document the StudioCMS patch and report it upstream, Starlight docs site on GitHub Pages)
- [ADR 0035](decisions/0035-npm-release.md): both packages at 0.1.0 with README, LICENSE, `author`,
  `engines`, `keywords`, `publishConfig` (public, provenance); Tapestry ships
  `patches/studiocms@0.6.1.patch` (the two islands hunks; applies cleanly to a pristine 0.6.1).
  `.github/workflows/release.yml`: on a GitHub release, checks + `pnpm -r publish --provenance`
  (trusted publishing, `NPM_TOKEN` fallback). Root LICENSE; README status refreshed.
- StudioCMS issue #37 drafted in `docs/upstream/` (no `gh` here; file once on GitHub).
- Waiting for: the GitHub repository URL (for `repository`/`homepage`/`bugs`, and to publish).

### Documentation site
- [ADR 0036](decisions/0036-documentation-site.md): `website/` (Starlight 0.42.5, reviewed) built from
  `docs/` and the package READMEs by `scripts/sync-docs.mjs` (titles from headings, links rewritten
  to site URLs or GitHub); `.github/workflows/docs.yml` deploys to GitHub Pages (SHA-pinned Pages
  actions). 48 pages, 2,553 internal links checked with a `/tapestry` base, none broken.
- Audit: a moderate advisory via Expressive Code (`postcss-selector-parser` < 7.1.6), fixed with a
  scoped override (`postcss-nested` 8.0.1).
- Learned: Starlight 0.39+ wants sidebar groups as `items: [{ autogenerate }]`; GitHub's API
  `git/ref` lookups were unreliable here, `git ls-remote` gave the action tag SHAs.

### Next
- Waiting for the GitHub repository URL: add `repository`/`homepage`/`bugs`, push, enable Pages,
  configure npm trusted publishing, file the StudioCMS issue (#37), publish 0.1.0 via a release.

---

## 2026-10-07: Session 20: Phase 5: migrations, translations

**Request:** finish the Phase 5 items, in order.

### Done
- **Migrations** ([ADR 0031](decisions/0031-migrations.md)): components get `version`, a `migrations`
  module (`{ 2: (props) => … }`) and `replaces` (renamed types). Nodes record `version` (only when
  above 1). Migrations run lazily inside `validateDocument()`, on a copy, before the usual
  cleaning; failures keep the earlier props with an error; newer-than-installed versions are kept
  with a warning. `virtual:tapestry/manifest` is now generated JS that imports the migration
  modules. Format migrations (`migrateFormat()`, `FORMAT_MIGRATIONS`) refuse newer formats, and
  version 2 is reserved (the stored page wrapper), so the next format is 3.
- Playground: Counter version 2 (`start` → `initial`).
- **Fix:** the info popover registered its outside-click listener in a passive effect; a quick
  click could arrive first (seen once in a full e2e run). Now a layout effect.

### Learned
- The shared version number space (document 1, stored page 2) would have bitten the first format
  migration; it's now encoded (`RESERVED_FORMATS`) and tested.

- **Translations** ([ADR 0032](decisions/0032-translations.md)): StudioCMS's content-language rows
  turned out to be data-model only (the dashboard never edits them; titles and slugs can't vary),
  so each language is its own page in a translation group (plugin-data rows `{ lang, source }`).
  `languages` option; a translations menu in the editor (status per language, "Create French
  version": an unpublished copy at `fr/<slug>`, opened in the editor); `getPage()` returns
  `language` and the visible `translations`; page links follow the current language. Playground:
  `['en', 'fr']`, `<html lang>`, hreflang links and a zero-JS language switcher.

### Learned (translations)
- StudioCMS slugs may contain `/`; `SDKCoreJs.POST.page` wants booleans for the flag columns.
- Dev-mode HTML carries `data-astro-source-*` attributes: e2e regexes must allow extra attributes.

### Verified
- Unit: Tapestry 392 (+32), media library 174. Lint and typecheck clean.
- Full e2e: 22 suites, 194 steps (new: migrations 4, translations 8).

---

## 2026-10-07: Session 19: Editor UI clean-up

**Request:** tidy the editor before the rest of Phase 5: (1) the Components panel in StudioCMS's
dark purple with white text; (2) icon buttons for collapse/expand all; (3) better markers in the
page structure (a purple dot for leaves, a purple chevron for containers); (4) and (5) keyboard
hints behind info buttons with a closable popup, in the page structure and in a new bottom
toolbar of the canvas (≥ 8 px padding).

### Done
- **Components panel:** `--tp-brand: hsl(259 74% 25%)` (StudioCMS's light-theme `--primary-base`),
  the same in both themes, white text (≈ 11:1); search field, items, thumbnails, pattern actions
  and focus rings adjusted for the dark background; the preview popover keeps editor colors.
- **Page structure:** collapse/expand all are icon buttons (`aria-label` + `title`). Rows show a
  16×16 purple dot (no children) or a purple chevron that turns right when collapsed. Both use the
  theme's `--primary-base`, so they stay visible in dark mode.
- **Info popovers** (`InfoPopover.tsx`, new `UI_ICONS` in `icons.tsx`): an "i" button opens a
  small dialog with the shortcuts as a list; ✕, Escape (focus returns to the button) or a click
  outside closes it. The same shortcuts stay in a visually hidden `aria-describedby` text for
  the tree and the canvas iframe.
- **Popover placement** (follow-up): the page-structure popover was right-aligned, so it opened
  leftwards under StudioCMS's inner sidebar (`#sui-sidebar-inner`). Popovers now left-align with
  their button (opening towards the editor) and flip to right-aligned only when there's no room on
  the right (measured before paint). The layers e2e step checks it never overlaps the sidebar.
- **Canvas footer:** `<div class="tp-canvas__footer" role="toolbar">` (8 px padding, room for
  future tools) instead of the `#tp-canvas-keys` paragraph; the id now names the hidden
  description inside it.
- **Fix:** the link field's "Page on this site" click could be undone. It synced its mode from the
  stored link in a passive effect, which can run *after* a quick click. This was the real cause
  of the intermittent links-suite failure (session 17 suspected SQLite). It now follows outside
  changes only, in a layout effect.

### Learned
- StudioCMS saves the dashboard theme **per user, on the server**, when `data-theme` changes.
  Setting it in a screenshot script switched the dev account to light; the canvas iframe follows
  the dashboard's `color-scheme`, so the canvas suite's "canvas looks like the public page" step
  failed until the theme was switched back.
- The failure dump added to the links suite in session 17 paid off: it showed the mode buttons'
  state, which pointed straight at the effect race.

### Verified
- Unit: Tapestry 360, media library 174. Lint and typecheck clean.
- Full e2e: 20 suites, 182 steps (layers +1: icon labels, popovers, footer padding).
- Screenshots in the dark and light dashboard themes: panel colors, row markers, both popovers.

### Next
- Phase 5: document migrations framework, i18n, component permissions, a11y + performance budget,
  npm publish (ask first), documentation site.

---

## 2026-10-07: Session 18: Interactive components (islands)

**Request:** Phase 5, starting with islands. Asked whether to add `@astrojs/preact` to the
playground (Babel-based build tooling); the user chose full support (option 1).

### Done
- **Islands** ([ADR 0030](decisions/0030-islands.md)): framework components (`.tsx`, `.jsx`,
  `.svelte`, `.vue`) as Tapestry components; `client: 'load' | 'idle' | 'visible'` makes them
  islands through generated `.astro` wrappers (`node_modules/.tapestry/islands/`).
- **StudioCMS strips component scripts** (known issue #37): its post-render passes re-sanitize the
  rendered page and drop every `<script>`, so islands never hydrated (and Astro component scripts
  in Tapestry components were silently lost). Patched: renderers opt out with
  `componentScripts: true`; Tapestry does. Adversarial e2e step for content payloads.
- **Canvas** runs new scripts from live renders once (`canvas/scripts.ts`), so an island added
  while editing hydrates; plain-text editing skips text inside islands.
- Playground: `@astrojs/preact` 6.0.5 (reviewed in ADR 0030; 6.0.6 is inside the release-age
  window), `preact` as a direct dependency, a Preact **Counter** component (`client: 'visible'`).
- Biome now ignores `.claude/` (local tool settings, not project code).

### Learned
- Astro emits the island bootstrap (`<style>` + directive and runtime `<script>`s) inline before
  the first island; StudioCMS kept the `<style>` but dropped the scripts, which pointed at a
  sanitizer that only drops `<script>`: ultrahtml's default.
- The render endpoint goes through the same StudioCMS renderer as public pages, so the canvas
  showed the same problem: one fix covered both.
- Production check: pages without islands are unchanged; a Counter page loads ≈ 7.9 KB gzipped.

### Verified
- Unit: Tapestry 360 (+7), media library 174. Lint and typecheck clean. `pnpm audit`: only the two
  reviewed advisories.
- Full e2e: 20 suites, 181 steps pass (new: islands 5).
- Production build: island hydrates for an anonymous visitor (e2e) and ships only on its page.

### Next
- Phase 5: document migrations framework, then i18n, component permissions, a11y + performance
  budget, npm publish (ask first), documentation site.

---

## 2026-10-07: Session 17: Phase 4 complete (plain text on the canvas, links, lists, slots, patterns, previews)

**Request:** continue the roadmap in order (same request as session 16).

### Done
- **Dependabot** (`.github/dependabot.yml`): weekly; Actions SHAs and npm (pnpm lockfile);
  minor/patch grouped; 3-day cooldown matching `minimumReleaseAge`. Active once on GitHub.
- **Plain `text` props editable on the canvas** ([ADR 0024](decisions/0024-inline-editing-plain-text.md)):
  the element showing the value is found automatically (or marked with
  `data-tapestry-text-prop`); ambiguous matches stay in the panel.
- **Link prop** ([ADR 0025](decisions/0025-link-prop.md)): `link` stores a page id or a web
  address plus `newTab`; components get a `ResolvedLink` (href, external, newTab, rel, title).
  Page links follow renames, and resolve to `null` for deleted pages and, for visitors, draft
  pages. Editor field with a page list from the new editors-only `GET /_tapestry/pages`.
  Stored strings are read as web addresses, so `url` → `link` is a safe switch. The
  playground Button uses it (its `newTab` prop is gone).
- **List (repeater) and object props** ([ADR 0026](decisions/0026-list-and-object-props.md)):
  items are objects of single-value fields (one level of nesting); invalid items are dropped,
  not the node; at most 100 items. Media and links resolve at any level (`collectRefs()`,
  pure). Editor: collapsible items with move/remove/add (each one undo step), focus
  management and announcements. Playground: an FAQ component (`<details>`, zero JS).
- **Named slots** ([ADR 0027](decisions/0027-named-slots.md)): `slots` on a definition, `slot`
  on children (one children array, grouped by area). StudioCMS's registry only passes a default
  slot, so the renderer wraps slot children in `<tapestry-slot>` and `Node.astro` splits them
  (`splitSlots()`) into real Astro named slots. Canvas drop areas per slot, a group per slot in
  the page structure, keyboard moves across slots. Playground: "Two columns".
- **Patterns** ([ADR 0028](decisions/0028-patterns.md)): "Save as pattern…" in the settings panel;
  the library's Patterns section inserts fresh copies (click or drag, tree and canvas); author or
  admin can delete. Stored as plugin data rows; editors-only same-origin API. Node and pattern
  names now also drop bidi override characters.
- **Library thumbnails and live previews** ([ADR 0029](decisions/0029-library-previews.md)): hover or
  focus a component to see it rendered with its starting values (sandboxed frame, the canvas
  page's CSS); an optional `thumbnail` image shows instead, and as an icon on the item.
  Playground: an SVG thumbnail for "Two columns". **Phase 4 is complete.**
- **Fix:** the link field cached a failed page-list load for the whole session (empty list, no
  way out); it now shows "Couldn't load the site's pages. Try again" and retries.
- **Fix:** dragging a component by its editable plain text left that text focused (Chrome
  refocuses the drag source on dragend); the re-render then restored the caret and Ctrl+Z
  went to the browser instead of undoing the move. The canvas now blurs it on `dragend`.

### Learned
- Blurring in `drop` isn't enough: Chrome gives focus back to an editable drag source when
  the drag ends, after `drop`. (Caught by the canvas suite's undo-after-drag step.)
- StudioCMS's page edit endpoint updates its page cache, so a renamed page's new slug is
  visible to the next render (no 5-minute wait).
- Nested field ids built with `-` collided: a field named `label` inside an object got the
  object's own `…-label` id, so the test typed into nothing. Nested ids now use `__`.
- The validator refactor (one `cleanSlot` for props, fields and items) kept every existing
  test passing unchanged, which made the new types cheap to add.
- Storing the slot on the child (not a map on the parent) meant no tree walker changed; only
  placement code (insert/move targets, drop geometry, the layer tree's grouping) learned slots.
- e2e geometry again: `realDrag()` resolves its target *after* pressing, so a resolver that
  scrolls moves the page mid-drag; and a point helper that scrolls the outer page even with
  `scroll: false` invalidates earlier points. Resolve both points first, without scrolling.
- `page.waitFor()` returning an `<option>` element never became truthy through CDP's by-value
  result; return booleans.
- The layers hover test broke when "Save as pattern" made the Section settings taller: the sticky
  settings panel can be the tallest column, so selecting another component changes the page
  height, the scroll position clamps, and rows move under the pointer. The test now selects
  first; the layout quirk is noted for canvas polish (cap the panel to the viewport).

### Verified
- Unit: Tapestry 353 (+83), media library 174. Lint and typecheck clean.
- Full e2e: 19 suites, 176 steps pass (new: links 10, lists 9, slots 7, patterns 6, library 4).
- Screenshots checked by eye: the preview popover (live Hero; thumbnail for Two columns) and the
  library's inline thumbnail icon.
- The links suite failed twice in full runs ("target page listed") and never alone; the likely
  cause is the cached failed page-list load above (suspected SQLite busy, #23). The suite now
  uses "Try again" and prints the editor state if it fails again.

### Next
- Phase 5, in order: interactive islands (then re-run client scripts after a live swap),
  document migrations, i18n, component permissions, a11y + performance budget, npm publish
  (ask first), documentation site.
- Polish: keep the settings panel within the viewport (scroll inside it) so selection changes
  don't move the page.

---

## 2026-10-06 – 2026-10-07: Session 16: Roadmap: editor, canvas and publishing follow-ups

**Request:** complete the roadmap features in order, minding deferred items and dependencies.
The user dropped two items: "View page" on StudioCMS's edit screen (it would need a
StudioCMS patch; no extension point) and shareable preview links.

### Done
- **Layer tree** (Phase 2 follow-ups):
  - collapse/expand (toggle, ←/→, collapse/expand all, reveal on selection, opens while hovering during a drag);
  - auto-scroll while dragging;
  - node names (`label`, editor-only, canonical key order, shown on rows and the canvas chip);
  - copy/cut/paste as validated clipboard text with fresh ids, so it works between pages.
- **Canvas** (Phase 3 follow-ups):
  - drop zones in empty containers (canvas mode only);
  - keyboard navigation on the canvas, sharing `structure-keys.ts` with the tree;
  - partial re-render of a single changed component (`partial.ts`); label-only changes skip rendering.
- **Publishing** ([ADR 0023](decisions/0023-scheduled-publishing-and-version-comparison.md), [ADR 0022](decisions/0022-publish-permission.md)):
  - **Scheduled publishing** with no background job: every reader applies due schedules.
  - **Version comparison:** a change list plus both versions on the real page via the editors-only
    `?tapestry-version=…`. This also covers Phase 5's "visual diff".
  - **Publish permission** (`publishPermission`), enforced in the middleware by rewriting saves
    from non-publishers. The playground requires admin.
- Fixes found on the way:
  - StudioCMS can't delete any user (inverted check; patched, #35).
  - Constrained editor inputs silently blocked StudioCMS's Save (#36).
  - Canvas "pending" never cleared when an edit was undone before rendering.

### Learned
- A drag-enter timer in Pragmatic DnD got a spurious drag-leave right after entering; dwell
  measured in `onDrag` is robust.
- In e2e, drop zones appear when a drag starts and shift rows; `page.center()` scrolls; canvas
  markers have no box. Three test bugs, all from geometry assumptions.
- `next(request)` in Astro middleware rewrites the request for the endpoint (used by the publish guard).

### Verified
- Unit: Tapestry 270 (+55), media library 174.
- Lint and typecheck clean. New/updated e2e suites: layers 9, canvas 19, publishing 13, permissions 6.
- Full e2e run: all 14 suites, 139 steps pass.

### Next
- Dependabot config, then Phase 4: inline editing for plain text props, link prop, repeaters/objects,
  named slots, patterns, component thumbnails.

---

## 2026-10-06: Session 15: Clean console on public pages

**Request:** look at the console errors and warnings on public pages (Permissions-Policy
`attribution-reporting`, `SELECT * FROM "main".sqlite_schema`, a 500, a long `ParseError`)
and fix whatever comes up.

### Done
- **Captured it ourselves** with a CDP script that records console messages, exceptions,
  browser log entries, failed requests and policy headers. Covered logged out and logged in,
  dev and production, and home, other page, draft preview and 404.
- **StudioCMS dev-toolbar "Database Viewer"** (known issue #12) was the source of everything
  you listed:
  - It embeds an external site in an iframe and feeds it the local database; that site logs
    the `sqlite_schema` query and sends the `attribution-reporting` policy.
  - Its query endpoint answered 500, hence the `ParseError`.
  - The endpoint also ran any SQL **without a login** in dev.

  Patched: the toolbar app isn't registered, and the endpoint requires the owner role in dev too.
- **favicon.ico 404**: playground favicon (`public/favicon.svg` + `<link rel="icon">`).
- **Found on the way:** the public 404 page was StudioCMS's, rendered in the full dashboard
  layout (~190 KB, with the dashboard's hidden user forms; #34). Fix: the site's own
  `src/pages/404.astro` plus `features.dashboardConfig.inject404Route: false` (avoids the
  route collision). Now 1.5 KB in production.
- **Tests:** the e2e harness no longer ignores any console errors. New site step: a logged-out tab
  (`cdp.page({ isolated: true })`, its own browser context) must see no console messages, log
  entries or failed requests on the home page, and the 404 page must be the site's.

### Verified
- Console after the fixes:
  - Dev, logged out and logged in: only Vite's debug "connected" lines.
  - Production: nothing.
  - 404: only its own 404 status.
- All 12 e2e suites pass with no ignored errors (site suite now 12 steps); lint and typecheck clean.

### Next
- Upstream reports when asked (#12, #32, #33, #34).
- Phase 4: link prop, repeaters, named slots.

---

## 2026-10-06: Session 14: Dashboard CSS off public pages

**Request:** the logged-out home page has lots of inline `<style>` tags (Markdown heading
styles and more) that don't apply to anything; find out what they are and remove them.

### Done
- **Measured first**, dev vs. production, logged out:

  | | Dev page | Production page | Production stylesheets |
  | --- | --- | --- | --- |
  | Before | 295 KB, 102 style tags | 7.4 KB HTML | `DashboardLayout` 54 KB, `BaseLayout` 13 KB, `library` 8 KB, Markdown 1.9 KB |
  | After | 10 KB, 6 style tags (site's own) | 5.3 KB HTML | only the site's 3.2 KB inline CSS |
- **Traced** the import chains in the build graph ([ADR 0021](decisions/0021-keep-dashboard-css-off-public-pages.md),
  known issue #32):
  - StudioCMS's middleware imported a dashboard component (via `studiocms:i18n`);
  - Astro's manifest puts the middleware in every page's graph;
  - Astro's dev collector walks through the manifest.
- **Patched** (`pnpm patch`, reasons in `pnpm-workspace.yaml`):
  - StudioCMS middleware (one line);
  - Astro's dev CSS collector (stop at the manifest);
  - @studiocms/md: no global CSS; the layout inlines `studiocms:md/styles-inline` on Markdown pages (#33).
- **Media library:** stylesheet loaded on demand (`ui/styles.ts`, `?url` + `<link>`) instead of
  a CSS import in browser code.
- Dockerfile copies `patches/` before `pnpm install` (otherwise the image build fails).
- Known issues #2 (open since session 1) and #14 resolved.

### Learned
- Dev output isn't representative; check production builds for what visitors get.
- Astro 7 collects dev CSS in `vite-plugin-css`, not `crawlGraph` (a first dev patch in the wrong
  place did nothing; found by instrumenting).
- A first StudioCMS patch (`astro:config/server` → `import.meta.env.SITE`) wasn't enough, because
  `studiocms/effect` reaches the manifest too. Cutting the one bad edge (middleware → component)
  fixed it, and the extra patch was dropped.
- When instrumenting `node_modules`, move the original aside (keeps the pnpm store's hard link
  intact) and restore with absolute paths. One restore ran from the wrong directory and was
  caught and fixed right away.
- Left alone: the 174-byte transition-event polyfill from @studiocms/ui (the dashboard needs it;
  Astro can't inject per page).

### Verified
- Lint, typecheck, unit tests (174 + 215) clean; all 12 e2e suites pass. Screenshots: editor,
  picker and Media page fully styled (the library's CSS loads on demand).
- Production build and Docker image: the public page has only the site's CSS (plus the polyfill).
- Dev dashboard: the site layout's CSS no longer appears there.

### Next
- Report upstream when the user asks: StudioCMS (#32 middleware, #33 md), Astro (#32 dev collector).
- Phase 4: link prop, repeaters, named slots.

---

## 2026-10-06: Session 13: Media editing extras, resized images, CI

**Request:** continue the roadmap in the proposed order (replace file, folders/tags,
captions, focal point, responsive images, CI), **without S3** (no use for it now; maybe later).

### Done
- **Media editing extras** ([ADR 0019](decisions/0019-media-editing-extras.md)):
  - New columns (tags, focal point, tracks, variants), added to existing tables on first use.
  - Storage keys can carry a suffix, so a replaced file, a resized copy or a caption file always gets a new URL.
  - **Replace file** with the same checks as an upload, the same kind required; the id and its metadata are kept.
  - **Tags** with a toolbar filter and chips with suggestions.
  - **Focal point**, set by click or arrow keys, with crop previews.
  - **Captions/subtitles**: WebVTT, or SRT converted; files rebuilt by `subtitles.ts`.
  - **Resized WebP copies** with sharp (`srcset`), plus an admin backfill on the settings page.
  - `Media.astro` now emits `srcset`/`sizes`, `object-position` and `<track>`; the playground Hero uses a variant and the focal point.
  - Shared upload checks moved to `receive.ts`.
- **Bug fixed:** SQLite `LIKE` has no default escape, so the media search's backslash escaping
  never worked (`_`/`%` in a search matched wrongly). Search, tag filter and usage now use
  `LIKE ? ESCAPE '!'` (Kysely `sql`; kysely 0.29.6 added as a dependency, the version StudioCMS uses).
- **Delete button contrast:** StudioCMS's `--danger-base` is a dark fill; the button is
  now solid `--danger-vibrant` with white text, and error text mixes red with the text colour.
- **CI** ([ADR 0020](decisions/0020-continuous-integration.md)): `.github/workflows/ci.yml` with
  three jobs:
  - checks;
  - e2e on a fresh site: `CMS_SETUP=1` plus `scripts/setup-site.mjs` replace the browser wizard;
  - the production image, run hardened, healthcheck, non-root, plus a sharp check.

  Actions are pinned to SHAs, with a read-only token; the workflow passes `actionlint`.
- Dependencies: `sharp` 0.35.5 and `kysely` 0.29.6. Review in ADR 0019: provenance throughout,
  no install scripts.

### Learned
- **A bundled sharp can't load its binary** (known issue #30). Astro bundles workspace packages
  into `dist/server`. Only the production build showed it, and the Docker test caught it.
  Fix: resolve sharp at runtime from the package's install location.
- Running all suites against a **fresh** site (scratch DB, second dev server on :4500) found
  three test assumptions:
  - resetting an already-published demo page sends no save;
  - the media suite counted items it didn't add (session 12);
  - an inline-editing step raced the toolbar re-render (flaky, 2 of 4 runs).

  All fixed; the inline suite then passed 5 of 5 runs.
- StudioCMS dashboard saves go to the configured site URL, not the page's origin (#31).
- StudioCMS's setup wizard is two JSON endpoints; `process.env` works in `studiocms.config.mjs`.
- One "Failed to fetch NPM package data" burst (StudioCMS update check) in the container;
  outbound requests from the hardened container work, so it was a network blip.

### Verified
- Unit: media library 174 (+60), Tapestry 215. Lint, typecheck, audit (2 reviewed ignores),
  production build clean.
- e2e on the dev server: 12 suites, 136 steps (new: media extras 7). All 12 also pass against a
  fresh scratch site (the CI flow), where the backfill button was exercised too.
- Docker: image builds; in the production container, uploads make WebP copies, captions are
  converted and attached, `%` searches are literal; sharp resolves on a read-only filesystem.
- Smoke tests of every new endpoint; the user's library items untouched (the backfill e2e step
  skips itself when other images need copies).

### Next
- Push to GitHub to run CI; add Dependabot/Renovate for action SHAs.
- Phase 4: link prop (internal page picker), repeaters, named slots.

---

## 2026-10-06: Session 12: Media library settings page

**Request:** a settings page like Tapestry's where admins adjust the upload size limits
and turn SVG uploads on or off; then continue with the roadmap.

### Done
- **Plugins → Media Library → Uploads** ([ADR 0018](decisions/0018-media-upload-settings.md)):
  `SettingsPage.astro` (StudioCMS layout, inner sidebar, admins only), number inputs per kind
  (whole MB) and an SVG checkbox; `POST /_media/settings` (same-origin, admins, 8 KB, invalid
  input saves nothing and is reported); storage in `StudioCMSPluginData`.
- Pure `settings.ts` (parse/clean, form, env ceiling). New options `allowSvg` (default true) and
  `maxUploadSize` (default 1 GB; `MEDIA_MAX_UPLOAD_MB` overrides). Uploads read the settings on
  every request; `detectType(…, { allowSvg })`. `GET /_media/api/settings` for the library UI
  (no `.svg` in the file dialog when off; client-side size check uses the live limits).
- Docker: Caddy `max_size {$MEDIA_MAX_UPLOAD_MB:1024}MiB` (verified with `caddy adapt`: 1 GiB
  default, 300 MiB with the variable); `.env.production.example` documents it.

### Learned
- The media e2e suite assumed an empty library; with the user's own two items it passed its
  "5 uploads" wait early and cleaned up while uploads were still running (leaving two test files).
  It now counts only its own items. The Tapestry settings suite assumed Tapestry was the only
  plugin listed.
- One unexplained first-run failure of the new suite right after restarting the dev server
  (likely Vite's first compile of the page); 4 later runs passed.

### Verified
- Unit: media library 114 (+24), Tapestry 215. Typecheck, Biome, audit (2 reviewed ignores)
  clean; production build OK.
- e2e: all 11 suites, 122 steps (new: media settings 7).

### Next
- Media roadmap: captions, responsive images, focal point, replace file, folders/tags; CI.

---

## 2026-10-06: Session 11: @nascencestudio scope, media library, Docker

**Requests:** put everything under the user's business, Nascence Studio
(`@nascencestudio/tapestry`, `@nascencestudio/medialibrary`); build a Drupal-style
media library as a separate plugin (AVIF; SVG with sanitizing; 10 MB images, 200 MB
video; remote videos) usable from components and the rich text toolbar; Docker for a
Hetzner Cloud CPX server.

### Done
- **Rename** ([ADR 0015](decisions/0015-nascence-studio-namespace.md)): package, imports,
  docs, plugin id, settings page URL; toolbar settings read from the old row id too.
- **`@nascencestudio/medialibrary`** ([ADR 0016](decisions/0016-media-library.md)): content-based
  type detection (incl. AVIF), header-based image dimensions, allowlist SVG sanitizer,
  YouTube/Vimeo parsing with oEmbed titles, streamed uploads to local disk, Kysely table
  created on first use, editors-only API, public file route (ranges, sandbox CSP, nosniff),
  dashboard Media page (main sidebar group), picker dialog, `Media.astro`, server lookups.
- **Tapestry integration:** `media` prop type (`accept`), resolved to items in `Node.astro`;
  rich text `media` entry ("Insert media", `mediaAccept`) with editor previews (panel and
  canvas); virtual modules detect the library at build time (Tapestry works without it).
  Playground Hero has a background image; Text has "Insert media".
- **Docker** ([ADR 0017](decisions/0017-docker-deployment.md), [guide](guides/deployment.md)):
  multi-stage image (Node 22.23.3, Corepack pnpm, `pnpm deploy`), non-root, read-only FS,
  migrations at start, `/data` volume; Compose with Caddy (HTTPS, headers);
  `security.allowedDomains` so `Astro.url` is `https://` behind the proxy. `.nvmrc` → 22.23.3.

### Learned
- Fixture files for every format generated with `sharp` and `ffmpeg` (real headers).
- Optional peer dependencies on workspace packages need `workspace:^`, or pnpm asks the registry.
- Registering a plugin dashboard page activates StudioCMS's `/dashboard/[...pluginPage]`,
  which outranks `[dashboard]`-parameter routes (known issue #28); Tapestry now also
  registers the literal `/dashboard/...` path.
- Behind a reverse proxy, same-origin checks need Astro's `allowedDomains` (otherwise
  `Astro.url` is `http://` while browsers send `Origin: https://`).
- Two real UI bugs found by e2e: controlled inputs in the details panel lost typing on
  re-render; the media field's buttons jumped when the preview loaded.

### Verified
- Unit: media library 90, Tapestry 215. Typecheck, Biome, audit (2 reviewed ignores) clean;
  production build OK.
- e2e: editor 14, canvas 17, site 11, page types 5, publishing 11, rich text 12, inline 13,
  settings 6, media 8, media + Tapestry 8 (108 steps).
- Docker: image builds (35 s), fresh volume → migrations → healthy, non-root, read-only FS;
  backup command and CLI user creation checked in the container; Compose config validated.

### Next
- Media: captions, responsive images, replace file, folders/tags (known issue #29).
- CI building the image and running tests.

---

## 2026-10-06: Session 10: Icon-only formatting toolbar

**Request:** the toolbar mixed icons and words; use icons throughout, with the text
style (P, H1…) and alignment controls showing the current setting.

### Done
- `editor/icons.tsx`: inline SVG icons drawn for Tapestry (link, lists, quote, line,
  remove formatting, four alignments, chevron) and consistent letter glyphs.
- Text style and alignment became accessible **menu buttons** whose icon follows the
  cursor (P/H1–H6, alignment icon); native selects can't show icons
  ([ADR 0012](decisions/0012-rich-text.md), revision). Menus flip left near the right
  edge (found by a screenshot: the alignment menu opened off-canvas). Enter/Space on
  menu items handled explicitly; Escape in the toolbar returns to the text instead of
  deselecting the component (found by the e2e suite).
- e2e: inline suite +1 step (menus by mouse and keyboard, icons follow the text, menu
  inside the canvas) = 13; rich text and settings suites use the menus.

### Verified
- Unit 208/208; typecheck 0 errors; Biome clean; audit clean; production build OK.
- e2e: editor 14, canvas 17, site 11, page types 5, publishing 11, rich text 12, inline 13,
  settings 6 (89 steps).

---

## 2026-10-06: Session 9: More formatting (headings 1–6, alignment…); HTML plugin removed

**Requests:** turn the H3 button into an H1–H6 dropdown; add blockquote, strikethrough,
subscript, superscript and horizontal line buttons, and an alignment dropdown (left,
right, center, justify). Then: remove the HTML plugin (it was only a reference).

### Done
- Rich text ([ADR 0012](decisions/0012-rich-text.md), revision): toolbar entries
  `heading1`–`heading6`, `subscript`, `superscript`, `horizontalRule`, `alignLeft/Center/Right/Justify`;
  heading and alignment entries render as one dropdown each. Format: heading levels 1–6,
  optional `textAlign` on paragraphs/headings, `horizontalRule` nodes, sub/sup marks
  (mutually exclusive). Rendered as `h1`–`h6`, `hr`, `sub`, `sup` and a fixed
  `text-align` style. `stripDefaultAttrs()` keeps editor output byte-identical to stored values.
- Shortcuts: Ctrl/⌘+, / Ctrl/⌘+. (sub/sup), Ctrl/⌘+Alt+0–6 (paragraph/headings).
- Playground Text component: all of the above plus quote and strikethrough.
- **Toolbar settings now store turned-off buttons** (format 2, [ADR 0014](decisions/0014-admin-toolbar-settings.md)
  revision): with format 1, the new buttons were hidden until an admin enabled them
  (found by the e2e suite). Format 1 is still read.
- **HTML plugin removed** (user decision): package, config entry, `patches/` and
  `patchedDependencies`, the dev `optimizeDeps` workaround, its e2e steps. Known issues
  #19/#20 marked as no longer applying (kept for the upstream report). The lockfile lost
  CodeMirror and SunEditor with it.
- Tests: 9 new unit tests (208); rich text e2e gains a step for the new formatting and
  hostile alignment values (12 steps); page types suite now 5 steps.

### Verified
- Unit 208/208; `tsc`/`astro check` 0 errors; Biome clean; audit clean (2 reviewed ignores);
  production build OK.
- e2e: editor 14, canvas 17, site 11, page types 5, publishing 11, rich text 12, inline 12,
  settings 6 (88 steps).

---

## 2026-10-06: Session 8: Editable on selection; Tapestry under Plugins

**Feedback:** the second click to start editing wasn't intuitive and the double outline
looked bad; put the toolbar right under the chip, make room so it doesn't cover the
text, and drop the settings-panel field. "Text formatting" belongs under Plugins, as a
child of a "Tapestry" entry (more Tapestry settings later).

### Done
- **Editable on selection** ([ADR 0013](decisions/0013-inline-canvas-editing.md), revision):
  selecting a component (canvas or tree) makes its rich text editable at once; one click
  on text puts the caret there. Toolbar renders inside the canvas overlay under the chip;
  chip + toolbar sit above the component (below it without room, sticky for tall ones);
  `max-content` width, kept inside the visible area. No second outline.
- Typing doesn't re-render; other changes do and editing resumes with the same caret
  (`inline.suspend()/resume()`, session `selectionRange()/restoreSelection()`). Escape stops
  editing without deselecting; focus leaving the text no longer ends it. A static copy of
  the text stays visible until the re-render (no flash).
- Settings panel: "Edit this text directly on the canvas" with **Edit here instead**, only
  for fields the canvas can edit (`canvasTextTargets`).
- **Plugins → Tapestry → Text formatting** ([ADR 0014](decisions/0014-admin-toolbar-settings.md), revision):
  empty `settingsPage` (lists Tapestry under Plugins) + Tapestry's own page in StudioCMS's
  dashboard layout with a double sidebar; served at both the URL StudioCMS links to and the
  intended one; own session checks. The Admin entry is gone.
- e2e: inline suite rewritten (12 steps); rich text and settings suites use the new
  panel button and page URL.

### Learned
- StudioCMS's plugin links are missing a slash (#27); `requiredPermissions: 'none'` means
  no authentication; the double sidebar script needs `#back-to-outer` / `#show-page`;
  `studiocms/frontend/*` is exported and usable from plugins.
- Measure overlay elements after placing them horizontally: a wrapping toolbar changes
  height with position (it overlapped the text at first).
- ProseMirror empties its mount element on `destroy()`.

### Verified
- Unit 199/199; `tsc`/`astro check` 0 errors; Biome clean; audit clean; production build OK,
  and the Tapestry page renders on the production server at both URLs.
- e2e: editor 14, canvas 17, site 11, page types 9, publishing 11, rich text 11, inline 12, settings 6 (91 steps).

---

## 2026-10-06: Session 7: Remove formatting, inline canvas editing, admin toolbars

**Request:** the three rich text follow-ups: a "remove formatting" button, typing
directly on the canvas, and Drupal-style admin control of toolbar buttons.

### Done
- **Remove formatting** (`clearFormatting` button, Ctrl/⌘+\): removes marks from the
  selection, or stops typing with them. Added to the default toolbar and the
  playground Text component. It's an action, so it doesn't affect the allowlist.
- **Shared editor core** `editor/richtext-editor.tsx` (session: view, toolbar state,
  sync, focus-at-point; `RichTextToolbar`). `RichTextField` became a thin wrapper.
  Schema cache keyed by what's allowed, so fields that differ only in action buttons
  share a schema.
- **Inline editing on the canvas** ([ADR 0013](decisions/0013-inline-canvas-editing.md)):
  server-side owner registry + `<tapestry-canvas-text>` markers (canvas mode only),
  `canvas/inline.ts`, controller integration (double-click, click selected text,
  Enter; renders paused while editing; Escape doesn't also deselect), header toolbar
  with Done. Inserted links keep the active formatting (found by the e2e test).
- **Admin toolbar settings** ([ADR 0014](decisions/0014-admin-toolbar-settings.md)):
  `toolbar-settings.ts` (pure), dashboard page "Text formatting" (admins), admins-only
  `POST /_tapestry/settings`, storage in `StudioCMSPluginData`, settings applied to the
  editor's manifest.
- Tests: 15 new unit tests (199), e2e suites "inline editing" (10 steps) and
  "settings" (6 steps), both in `pnpm e2e`.

### Learned
- **StudioCMS `usePluginData()` can't save** (known issue #25): insert crashes, update
  silently does nothing, because the write goes through a cache already holding the
  lookup. Worked around with direct Kysely access to the same row.
- StudioCMS's generated `settingsPage` can't show saved values; `dashboardPages` with
  our own component can. Page URLs turn dashes into underscores (#26).
- Plugins *can* create tables (the Web Vitals plugin does); ADR 0011 annotated.
- ProseMirror works with its DOM in the canvas iframe while running in the dashboard window.
- **Correction:** last session's "editor main chunk ~24 KB" left out an 11 KB shared
  chunk. First load is ~35 KB gzipped (22.5 + 11.4 + ~1); docs fixed.

### Verified
- Unit 199/199; `tsc`/`astro check` 0 errors; Biome clean; audit clean (2 reviewed ignores);
  production build OK.
- e2e: editor 14, canvas 17, site 11, page types 9, publishing 11, rich text 11, inline 10,
  settings 6 (89 steps).

### Next
- Inline editing for plain text props (would need a component-side marker).
- Report upstream: #25 (plugin data), together with the earlier list when asked.

---

## 2026-10-05: Session 6: Rich text with a configurable toolbar (ProseMirror)

**Request:** a CKEditor-style formatting toolbar for body text, simple, with the
buttons chosen per field. The user picked ProseMirror (no Meta libraries, so not
Lexical). Decision: [ADR 0012](decisions/0012-rich-text.md).

### Done
- `richtext` prop type with a `toolbar` option (11 possible buttons; also the
  allowlist), `maxLength`, and a plain-text or rich `default`. Definition checks
  for unknown/duplicate buttons and defaults the toolbar wouldn't allow.
- `richtext.ts` (pure): stored format (ProseMirror JSON shape), `cleanRichText()`
  (toolbar allowlist, safe links, limits, plain-string conversion),
  `toRenderTree()`, plain-text helpers. Validator cleans rich text props (warning
  when formatting is removed; empty counts as missing).
- `RichText.astro` (`@tapestry/studiocms/RichText.astro`): recursive render from an
  allowlisted element tree, no `set:html`.
- Editor: `richtext-schema.ts` (schema per toolbar, safe paste rules) and
  `RichTextField.tsx` (toolbar with pressed states, shortcuts, inline link form,
  ProseMirror history), loaded as a separate chunk.
- Playground: Text component switched to `richtext` (bold, italic, link, lists, H3);
  the demo page has one rich text block and two plain-string ones (to exercise conversion).
- Dependencies: 8 ProseMirror packages (+3 transitive), reviewed in ADR 0012.
- Tests: 37 new unit tests (184 total), a new e2e rich text suite (11 steps) in `pnpm e2e`.

### Learned
- **Preact runs `useEffect` after paint.** Syncing outside changes into the field
  in a passive effect raced with fast typing: an older value was "restored" and the
  cursor jumped to the start (the e2e list step caught it). The sync is now a
  `useLayoutEffect`.
- **JSON key order matters** because documents are compared as strings (draft vs
  published). ProseMirror writes text nodes as `{ type, marks, text }`; the cleaner
  now does too, and a unit test checks byte-identical round trips.
- ProseMirror is ~67 KB gzipped, more than the 40–60 KB I'd estimated. Loading it
  on demand keeps the editor's main chunk at ~24 KB (gzip -9; the earlier "27 KB"
  figure used a different measurement).
- Process slip: I ran `npx --no-install tsc` once (npm tooling) instead of
  `pnpm exec tsc`. It found nothing to run and installed nothing; noted here because
  the rule is pnpm only.

### Verified
- Unit 184/184; `tsc`/`astro check` 0 errors; Biome clean; audit clean (2 reviewed ignores).
- e2e: editor 14, canvas 17, site 11, page types 9, publishing 11, rich text 11.
- Production build: rich text renders; public pages still load only Astro's 174-byte script.

### Next
- Inline text editing on the canvas (can reuse the schema and field).
- Phase 4: images, links to internal pages, repeaters.

---

## 2026-10-05: Session 5: Drafts, publishing and a 5-version history

**Request:** Drupal-style page status for Tapestry pages: save as a draft, publish
deliberately, keep 5 previous published versions. Scope: Tapestry only (no
StudioCMS changes). Decision: [ADR 0011](decisions/0011-draft-publish-history.md).

### Done
- `revisions.ts` (pure, 13 tests): stored page format 2 (`published`, `draft`,
  `history`), read-compatible with format-1 documents and `""`; `saveDraft`,
  `publish` (history capped at `historyLimit`, default 5), `discardDraft`,
  `restoreToDraft`, `documentFor`, `pageStatus`.
- Renderer renders `published` only. `getPage()` serves the draft to editors with
  `?tapestry-preview` and in the canvas, 404s never-published pages for visitors,
  and copies StudioCMS's cached page object instead of changing it.
- Editor: `publishing.ts` keeps the stored page in sync with the field;
  toolbar status pill, **Save draft**, **Publish**, **History (n)** panel with
  Restore to draft and Discard unpublished changes (both undoable). The JSON view
  accepts a pasted format-2 stored page.
- Admin bar: publishing status, **Preview draft** / **View published** links.
- **Found a leak and closed it:** StudioCMS's anonymous REST API
  (`/studiocms_api/rest/v1/public/pages`) returns raw stored content, so drafts and
  history would have been public (known issue #22). New plugin middleware
  (`runtime/middleware.ts` + pure `public-content.ts`, 9 tests) redacts every JSON
  response for non-editors. It matches on content because StudioCMS's router accepts
  `/pages/`, `//pages`, `/%70ages`, `/./pages` and `/pages;x`. Verified in dev
  (e2e) and against the production build.
- `getViewer()` moved to `runtime/viewer.ts` (still exported from `/page`).
- New e2e publishing suite (11 steps); added to `pnpm e2e`.
- `source-map-js` forced to 1.2.2 (`overrides`, GHSA-68fv-2mgg-jv7q, published
  2026-09-30, same maintainer, past the release-age gate).

### Learned
- **SQLite locking breaks StudioCMS saves** (known issue #23): the playground DB uses
  a rollback journal. The e2e helper polling the DB during saves made StudioCMS's
  update fail with HTTP 400, and after many overlaps, the dev server hung (logins
  returned 500) until restarted. `saveAndWait()` now waits for StudioCMS's save
  response over CDP, and `storedContent()` retries `SQLITE_BUSY`.
- StudioCMS's success toast covers the toolbar's Publish button for a few seconds
  (known issue #24); the harness's `page.click()` now waits until the target is
  actually under the pointer.
- StudioCMS's Edit History revert restores the whole stored page, including the
  live version (known issue #21). Use Tapestry's History panel.

### Verified
- Unit 147/147; `tsc`/`astro check` 0 errors; Biome clean; audit clean (2 reviewed
  ignores); production build OK (and API redaction checked on the built server).
- e2e: editor 14, canvas 17, site 11, page types 9, publishing 11. Three consecutive full
  runs passed before the middleware was added and one full run after it.

### Next
- Report upstream: #22 (public API exposes content), #23 (SQLite locking).
- Possible publishing follow-ups: scheduled publish, compare versions, separate
  publish permission.

---

## 2026-10-05: Session 4e: Remove WYSIWYG, fix the HTML editor's saving

**Reports:** WYSIWYG pages showed "Error parsing content"; HTML pages showed
"Error: No content found". The user asked to remove WYSIWYG and fix HTML.

### Findings
- **HTML (known issue #20):** reproduced. Typed text never reached the
  `page-content` textarea, so Save stored `""`. A regression in `@studiocms/html` 0.4.0
  (SunEditor 2 → 3 rewrite) dropped 0.3.0's `editor.onChange → editor.save()` sync.
  In SunEditor 3 the textarea is written only by its own "save" command.
- **WYSIWYG "Error parsing content"** on empty pages: StudioCMS substitutes
  `<h1>Error: No content found</h1>` for empty content and the WYSIWYG renderer
  `JSON.parse`s it. Not investigated further at the user's request.

### Done
- Removed `@studiocms/wysiwyg` (after confirming no WYSIWYG pages existed), its config
  entry, the `canvas` build denial, and its e2e cases. `pnpm audit` is back to clean
  (2 reviewed ignores).
- Fixed HTML via `pnpm patch` → `patches/@studiocms__html@0.4.2.patch` (`events.onChange`
  writes `$.html.get()` into the textarea), registered with a reason and exit condition.
- New e2e step: type into the HTML editor → Save → check the DB and the public page.
- Found while verifying: on a fresh dev server, Vite discovered the editor's
  dependencies on first visit and **reloaded the page**, which caused a one-off
  editor-suite failure. The plugin now pre-bundles them (`optimizeDeps.include`
  with `@tapestry/studiocms > …`). Verified: no reload message after clearing the Vite cache.

### Verified
- Unit 125/125; `tsc`/`astro check` 0 errors; Biome clean; audit clean (2 reviewed);
  production build OK.
- e2e from a fresh dev server: editor 14, canvas 17, site 11, page types 9, twice.

---

## 2026-10-05: Session 4d: StudioCMS page types, broken empty-type page, cleanup

**Reports:** only "Tapestry" in the page-type dropdown; a page created without a type
crashed the edit screen ("CurrentEditorComponent is undefined") and couldn't be deleted.

### Findings (known issues #15–19)
- StudioCMS ships **no** page types; the playground had only Tapestry. Not an override.
- The create form hard-codes `defaultValue="studiocms/markdown"`; without that plugin
  it submits `""`, and neither the form nor the server rejects it. The edit screen then
  renders an undefined editor, and Delete is unreachable. (StudioCMS bugs.)

### Done
- Installed `@studiocms/md`, `@studiocms/html` and `@studiocms/wysiwyg` (all with
  provenance, past the age gate) and registered them before Tapestry.
- Denied `canvas`'s install script (native module from the WYSIWYG image editor's
  fabric@4; Node-only).
- Deleted "Test One" (id `bf7cf9fc…`, empty type and content) through StudioCMS's
  `DELETE /studiocms_api/dashboard/content/page`; verified no leftover rows. The user's
  own new pages ("html", "wys") were not touched.
- Dev fix for the HTML editor: `optimizeDeps.include` for CodeMirror + its htmlmixed mode
  + SunEditor (it silently failed to load in dev; production was fine).
- New `page-types.e2e.mjs` (11 steps): create-form default and options, then per type:
  create, its own editor really loads (no Tapestry UI), and it renders via `getPage()`
  with the admin bar for editors only. The first version only checked that the editor
  area was non-empty and passed while the HTML editor was broken; it now waits for each
  real editor.

### Open
- **WYSIWYG adds 21 audit advisories** (2 critical, 10 high) via fabric@4, including two
  dashboard XSS advisories without a compatible fix. Left failing in `pnpm audit` pending
  the user's decision (known issue #18).

### Verified
- Unit 125/125; `tsc`/`astro check` 0 errors; Biome clean; production build OK.
- e2e: editor 14, canvas 17, site 11, page types 11, repeated runs green.

---

## 2026-10-05: Session 4c: Dashboard light mode unreadable in dev (user-reported)

**Report:** after switching StudioCMS to light mode, headings and tabs were about
the same color as the background.

### Diagnosis (known issue #14)
- Measured: text `rgb(0,0,0)` on body `rgb(18,18,22)`, contrast 1.12:1. The dark
  background came from the **playground's** `Layout.astro` (`body { background:
  var(--background) }`, dark values via `prefers-color-scheme`), not from StudioCMS.
- In `astro dev`, dashboard pages load the global CSS of **every site page**
  (a never-visited probe page's CSS appeared after a restart). Ruled out: route
  matching, load order, Tapestry's admin bar. Production is clean, and StudioCMS
  light mode measures 19.6:1.
- Name clash too: StudioCMS's `auth-layout.css` uses `var(--background)`/`var(--text)`.

### Fix
- Playground: site styles scoped to `<body class="site">`, variables renamed to
  `--site-*`; components updated.
- That surfaced a Tapestry weakness: `.site a` beat the admin bar's class-based
  isolation (purple links). The admin bar's selectors are now anchored on
  `#tapestry-adminbar`.
- Docs: site-author guidance (defining-components guide), troubleshooting row,
  ADR 0009 and admin-bar notes.
- The dev server needed a restart to stop serving the stale leaked stylesheet.

### Tests
- Site suite +1 step: dashboard light-mode contrast ≥ 4.5:1 (it failed at 1.12:1
  before the fix). Admin bar link color asserted. All suites green: editor 14,
  canvas 17, site 11; unit 125.

---

## 2026-10-05: Session 4b: Fix canvas drag-to-reorder (user-reported)

**Report:** reordering by dragging works in the page structure but not in the
canvas; the cursor turns into a hand on hover, but dragging never starts.

### Root causes
1. **The chip handle's drag was aborted instantly.** Our `dragstart` handler changed
   the overlay's class, which set `pointer-events: none` on the chip (the drag
   source) during `dragstart`; `dragover`/redraw also set the chip to `display: none`.
   Chrome aborts the drag: a real mouse drag logged `dragstart@33 dragend@34`. The
   suite missed it because it tested chip drags with **synthetic** `DragEvent`s.
2. **Components couldn't be dragged directly at all.** Only the small chip handle
   was draggable. Users naturally grab the component itself (as in the layer tree).

### Fix
- Drag handling moved to document-level `mousedown`/`dragstart`/`dragend` in the
  canvas. Pressing a component makes its top element draggable. The selected
  component wins if the press is inside it, otherwise the innermost one. Links and
  images move their component. The drag source is never modified during
  `dragstart` (visual changes deferred), and the chip stays rendered while dragged.
- Grab cursor on components in the canvas.

### Tests
- New `page.realDrag()` (genuine mouse input, no interception), which really runs
  native drag and drop inside the iframe in headless Chrome. Canvas suite: 13 → 17
  steps: chip drag, direct component drag, selected-container drag, link drag,
  grab cursor, all with real drags.
- Test-tooling lessons: resolve both drag points before pressing (a scroll in
  between cancels the drag); `childIds()` must search the whole tree.

### Verified
- Unit 125/125, `tsc`/`astro check` 0 errors, Biome clean; e2e editor 14 + canvas 17 + site 10,
  repeated runs green.

---

## 2026-10-05: Session 4: Visual canvas (Phase 3)

**Goal:** Make the editor visual: the editing surface should look exactly like
the public page, as in Drupal Canvas.

### Design ([ADR 0010](decisions/0010-visual-canvas.md))
The canvas is the page's real URL in an iframe with `?tapestry-canvas`. `getPage()`
enables **canvas mode** for editors (an `Astro.locals` flag), so `Root.astro`/`Node.astro`
emit invisible `display: contents` markers. Edits are POSTed to a new editors-only
`/_tapestry/render` endpoint and swapped into the iframe without reloading.
Checked first: no frame-blocking headers or CSP on StudioCMS pages.

### Built
- Server: `ROOT_ELEMENT` (`tapestry-root`) + node ids in the renderer output;
  `canvas-mode.ts`, `Root.astro`, canvas-aware `Node.astro`, `Render.astro` (injected
  route); `getPage()` canvas mode; admin bar hidden in the canvas;
  `tapestryComponentRegistry()` now returns both wrappers.
- Editor: `canvas/geometry.ts` (pure drop placement, 10 tests), `canvas/controller.ts`
  (live swap, overlay, chip, selection, native DnD, keyboard), `canvas/Canvas.tsx`
  (viewports, status, reload); shared `activeDrag` + `applyDrop()` in `dnd.ts`;
  new layout (canvas centre or top), full-screen mode, Save button, Ctrl/⌘+S.
- e2e: `canvas.e2e.mjs` (13 steps); helpers moved to `helpers.mjs`; `drag()` accepts
  computed points; the error filter ignores StudioCMS dev-toolbar sources by stack URL.

### Bugs and findings
1. **Dev styles leaked into the canvas.** The render endpoint's dev output carries
   Astro's `<style>` tags (including StudioCMS dashboard CSS) inside the content
   root; swapping them in would restyle the site. Caught by the visual-parity e2e
   step → page-level tags are stripped on swap.
2. **`all: unset` disables native dragging.** It resets `-webkit-user-drag`, so the
   chip's drag handle wasn't draggable for real users → restored explicitly.
3. **CDP can't intercept drags that start inside an iframe** (only top-level frames).
   The chip-drag test checks native draggability and dispatches drag events in the iframe.
4. **Clicks racing a re-render** could miss the moving chip → the iframe gets
   `data-tapestry-pending` while an update is queued or in flight; tests wait on it.
5. **Correction:** the DB Studio error from session 3 wasn't fixed by the 0.6.1
   upgrade. It's StudioCMS's dev-toolbar "DB viewer" app (dev-only, intermittent;
   known issue #12). Known-issues entry corrected.
6. `Astro.locals` set in a page reaches registry-rendered components (research notes).

### Verified
- Unit 125/125; `tsc` + `astro check` 0 errors; Biome clean; audit clean apart from the 2 reviewed advisories.
- e2e: editor 14 + canvas 13 + site 10 steps, all passing on repeated runs (canvas suite 4× in a row after the last fix).
- Production: canvas markers only for editors, render fragment clean (no style or script tags),
  editor chunk 27.2 KB gzipped (was 22.5).

### Next
1. Inline text editing on the canvas; per-node partial re-render.
2. "View page" for all page types; separate-tab Preview of unsaved changes.
3. Phase 4: rich content (images, rich text, named slots).

---

## 2026-10-04: Session 3: Admin bar and draft-safe pages

**Goal:** The user noticed StudioCMS has no preview, no way to jump from the
dashboard to the live page, and nothing like Drupal's admin toolbar. We
investigated, then built the first two pieces: draft-safe page loading and an admin bar.

### Investigation
- StudioCMS ships a client-side **Quick Tools** corner menu (avatar bottom-right, shown
  after the first mouse movement, ~18 KB script to every visitor). Its "Edit" goes to the
  content list, not the current page. There's no "view page" in the dashboard and no preview.
- No third-party plugins exist (the ecosystem is 8 official packages).
- **Security finding:** `GET.page.bySlug()` doesn't filter drafts, and the official
  `@studiocms/blog` route (which our playground copied) serves drafts publicly
  (known issue #10).
- StudioCMS only resolves the session on dashboard/API routes; public routes must ask
  via `User.getUserData()` from `studiocms:auth/lib` (research notes updated).

### Built ([ADR 0009](decisions/0009-server-rendered-admin-bar.md), guide: [admin-bar.md](admin-bar.md))
- `src/access.ts`: pure rules: permission ranks, `isEditor`, `pageAccess` (draft
  visibility + headers), `pagePath` (URL pattern). 10 new unit tests (114 total).
- `src/runtime/page.ts` → `@tapestry/studiocms/page`: `getViewer()`, `getPage()`.
- `src/runtime/AdminBar.astro` → `@tapestry/studiocms/AdminBar.astro`: zero-JS bar;
  markup **and** CSS emitted only for editors.
- Editor toolbar: **View page ↗** (from the slug field + new `pageUrlPattern` option via
  `virtual:tapestry/config`).
- Playground: route uses `getPage()`, layout renders `<AdminBar>`, corner menu disabled.
- e2e: shared `helpers.mjs`; new `site.e2e.mjs` (10 steps); `pnpm e2e` runs both suites.

### Bugs and surprises
1. Astro bundles a component's CSS whenever it's imported, so the bar's styles reached
   anonymous visitors → moved to an inline `<style>` rendered only with the bar.
2. `all: initial` on `.tapestry-adminbar *` would also un-hide a `<style>` placed inside
   the bar (CSS printed on the page) → the style sits next to the `<nav>`, plus an e2e check.
3. **`injectQuickActionsMenu` must be under `features`.** The top-level key is silently
   ignored, which is why session 1 thought it "didn't work". Public JS: 18,714 B → 174 B.
4. The editor suite caught a new browser error: StudioCMS DB Studio returned 500 on the
   edit page. Upgrading to **studiocms 0.6.1** (`@libsql/client` 0.18) fixed it.
5. Biome's import sorting moved a comment block under an import → restructured.

### Dependency changes
- studiocms 0.6.0 → **0.6.1**, `@libsql/client` 0.17.4 → **0.18.0**: removed the
  `peerDependencyRules` exception.
- vitest 5.0.2 → **5.0.3**: removed the `why-is-node-running` override.
- `pnpm audit`: clean apart from the 2 reviewed advisories; peers clean.

### Verified
- Unit 114/114; `tsc` + `astro check` 0 errors; Biome clean.
- e2e: editor 14/14 + site 10/10, three consecutive runs on the final code.
- Production: anonymous home page has no admin bar markup or CSS, 174 B of JS; anonymous
  draft → 404.

### Next
1. "View page" on StudioCMS's edit screen for all page types (check dashboard augments).
2. **Preview** of unsaved changes via `getPage()` + session-stored drafts, leading into Phase 3.
3. Report upstream: draft leak in `bySlug`/blog route; silently ignored config keys.

---

## 2026-10-02: Session 2: Visual editor MVP (Phase 2)

**Goal:** Build the drag-and-drop editor. The user asked whether to build on Puck.

### Puck evaluation → build our own ([ADR 0006](decisions/0006-build-our-own-editor-not-puck.md))
Measured in a scratch directory (outside the repo): Puck 0.23 needs React, bundles
to **367 KB gzipped** (303 KB even on `preact/compat`, which is unsupported), installs
115 packages, has **no provenance on any release**, and its canvas renders React
components, which our server-only Astro components can't be. We borrowed its UX
patterns instead.

### Drag-and-drop choice ([ADR 0007](decisions/0007-drag-and-drop-library.md))
Pragmatic DnD core + list-item hitbox (~7 KB gzipped) over `@dnd-kit/dom` (~35 KB,
pre-1.0). Pragmatic has no provenance; mitigated by pins, the age gate, and a tiny
dependency tree. Its 3.x/4.x import paths differ from most online examples.

### Built (`packages/tapestry/src/editor/`)
- `tree.ts`: pure immutable tree operations (insert, remove, move with cycle and
  `acceptsChildren` checks, update props, duplicate with fresh ids, keyboard nudges,
  insertion targets, valid initial props for required fields).
- `store.ts`: signals store with undo/redo (100 steps, typing coalesced per field).
- `dnd.ts`, `Library.tsx`, `Layers.tsx`, `PropsPanel.tsx`, `JsonView.tsx`, `App.tsx`,
  `mount.tsx`, `editor.css`. `Editor.astro` now mounts the Preact app (textarea
  fallback without JS).
- `validatePropValue()` exported from the validator for per-field errors.
- Playground: `scripts/demo-document.mjs` (shared demo page), `pnpm seed` now updates
  in place (preserves StudioCMS revision history), `e2e/` harness and suite.

### Browser e2e ([ADR 0008](decisions/0008-browser-e2e-via-cdp.md))
Dependency-free CDP client (Node 22 WebSocket + local Chrome). The 14-step suite
covers mounting, no-rewrite-on-open, prop editing, Enter-doesn't-save, library add,
keyboard move/undo/redo/delete, **native drag and drop** (reorder across containers,
drop inside a container, refusing cycles), **Save through StudioCMS** (DB checked),
public render, and no browser errors. Passed 4 consecutive runs.

### Bugs found by the e2e suite (all fixed)
1. Hidden row action buttons (`opacity: 0`) were still clickable → now `visibility: hidden`.
2. After deleting the focused row, focus fell to `<body>` and Ctrl+Z stopped working →
   undo/redo listen on the document, scoped to the editor or `<body>`.
3. Enter in a settings input submitted StudioCMS's form, which **saves the page** → suppressed.
4. Layout: the dashboard's content area is ~815 px wide, which squeezed the layer tree →
   container-query layout (three columns, or library strip on top, or stacked).
5. CSS cascade order made container-query rules lose to base rules → moved them last.

### Other findings
- StudioCMS saves unknown **named** form fields as plugin data. Editor controls are
  unnamed on purpose.
- StudioCMS caches pages (5 min), so direct DB writes (`pnpm seed`) may not show
  until the cache expires; the e2e suite resets through the editor instead
  (known issue #7).
- Someone (the user) created a draft "Test" page and saved Home via the dashboard;
  that revision history is why `pnpm seed` hit a foreign-key error and now updates in place.
- Two new **high** advisories with no patches (http-cache-semantics, braces). Reviewed:
  not exploitable here; ignored with reasons and a 2026-11-01 re-check (known issue #8).

### Verified
- Unit tests: 104 pass (29 new for the editor tree and store). `tsc` and `astro check`:
  0 errors. Biome: clean. `pnpm audit`: clean apart from the 2 reviewed advisories.
- e2e: 14/14, stable over repeated runs.
- Production build: editor chunk **22.5 KB gzipped**, dashboard-only.

### Next
1. Phase 3: live preview (authenticated preview endpoint, iframe canvas, click to select,
   viewport switcher).
2. Upgrade to studiocms 0.6.1 (≥ 2026-10-04), drop the peer rule.
3. Re-check the ignored advisories on 2026-11-01.

---

## 2026-10-02: Session 1: Foundation and render pipeline (Phases 0 and 1)

**Goal:** Kick off the project: pick an architecture for a Drupal Canvas-style
builder on Astro + StudioCMS, set up a secure monorepo, and get the smallest
end-to-end slice working, with thorough documentation.

### Research
- **Drupal Canvas**: React editor; code components run on **Preact**; SDC
  components with props and slots. Notes: [research/drupal-canvas.md](research/drupal-canvas.md).
- **StudioCMS 0.6 plugin API** (read from source; the docs are outdated): page
  types with `rendererComponent` + `pageContentComponent`; the renderer returns
  HTML; the **component registry** swaps custom elements for Astro components.
  Notes: [research/studiocms-internals.md](research/studiocms-internals.md).
- Latest versions: astro 7.3.5, studiocms 0.6.1 (blocked by age, so 0.6.0),
  preact 11 (unsupported by `@astrojs/preact`, so 10.x), TypeScript 7
  (unsupported by `@astrojs/check`, so 6.0.3).

### Decisions
- [ADR 0001](decisions/0001-build-as-a-studiocms-page-type-plugin.md): ship as a StudioCMS page-type plugin.
- [ADR 0002](decisions/0002-preact-for-editor-ui.md): Preact 10 + signals for the editor (DnD library TBD).
- [ADR 0003](decisions/0003-pnpm-and-supply-chain-hardening.md): pnpm 12 with release-age, trust, and build-script policies.
- [ADR 0004](decisions/0004-single-wrapper-element.md): one `<tapestry-node>` wrapper with URL-encoded props.
- [ADR 0005](decisions/0005-json-tree-document-format.md): versioned JSON tree document.

### Built
- Monorepo: `packages/tapestry` (`@tapestry/studiocms`), `playground`, Biome, Vitest, TS 6 strict.
- Plugin: `defineComponent`, `toManifest`, validator (limits, URL safety,
  never-throw cleaning), renderer, virtual modules, `Node.astro`, StudioCMS
  renderer, Phase 1 JSON editor with live validation.
- Playground: Astro 7 + StudioCMS 0.6 + local libSQL; six components (section,
  hero, heading, text, button, columns); catch-all page route;
  `pnpm seed` demo page script.
- Docs: CLAUDE.md, README, architecture, data model, security, roadmap, known
  issues, guides, research, ADRs.

### Course corrections (worth remembering)
1. **Per-component custom elements → single wrapper.** The first design emitted
   `<tapestry-hero heading="…">`. A test through the real ultrahtml pipeline
   showed attribute values aren't entity-decoded (`&quot;` would show up on the
   page) and every prop arrives as a string. Switched to ADR 0004. Bonus: typed
   props, and one registry line instead of one per component.
2. **Component types relaxed** from custom-element names (`tapestry-hero`) to
   kebab-case (`hero`), since they're no longer HTML tag names.
3. **Prop names starting with `on` are banned outright**, because components
   receive props as objects and may spread them onto elements.

### Supply-chain events (all investigated, none bypassed)
- `@parcel/watcher`, `msgpackr-extract` wanted install scripts → denied (optional accelerators).
- `why-is-node-running@3.2.2` flagged as a trust downgrade (no provenance) → overridden to 3.2.1 (same as Vitest upstream).
- `undici-types@6.21.0` flagged (Nov 2024 manual publish) → added `trustPolicyIgnoreAfter: 180 days`.
- `@libsql/client` peer conflict inside studiocms 0.6.0 → pinned 0.17.4 + `peerDependencyRules`.
- `pnpm audit`: no known vulnerabilities.

### Verified
- 75 unit tests pass (definitions, validation incl. prototype pollution and
  URL schemes, rendering, the real ultrahtml sanitize+swap pipeline, virtual modules).
- `tsc` (plugin) and `astro check` (playground): 0 errors. Biome: clean.
- Dev server: the seeded page renders real Astro components; quotes,
  ampersands, `<b>` and emoji come through correctly escaped; nested children,
  number and boolean props work.
- Dashboard: logged in via API; the edit page renders the Tapestry editor with
  the stored document; the page type appears as "Tapestry (visual builder)".
- Production: `astro build` succeeds (with the CSS workaround) and the built
  server renders the page.

### Problems found upstream
See [known-issues.md](known-issues.md) #1 (nested `@keyframes` breaks the
build), #2 (StudioCMS CSS/JS on public pages), #4 (peer conflict), #5 (outdated docs).

### Local environment notes
- Dev admin `tapestry-dev`; password in `playground/.dev-credentials` (gitignored).
- Database: `playground/studiocms.db` (gitignored).

### Next
1. Manually check the dashboard save round trip (known issue #3).
2. Upgrade to studiocms 0.6.1 after 2026-10-04; drop the peer rule.
3. Phase 2: drag-and-drop spike → ADR → Preact editor MVP.
4. Report the `@keyframes` bug upstream; investigate the public-page payload.
