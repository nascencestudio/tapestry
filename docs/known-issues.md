# Known issues

Upstream bugs, workarounds, and open questions. Remove an entry only when it's
resolved, and note the resolution in the devlog.

## Open

### 1. StudioCMS CSS breaks the default Vite 8 CSS minifier
- **Found:** 2026-10-02 · **Affects:** studiocms 0.6.0 and 0.6.1 · **Severity:** build-breaking
- `frontend/components/shared/ComponentRegistryUI.astro` nests `@keyframes`
  inside a style rule. Vite 8's default minifier (lightningcss) fails with
  `Unknown at rule: @keyframes`. Any site that sets `componentRegistry`, which
  Tapestry requires, hits this in `astro build`.
- **Workaround:** `vite.build.cssMinify: 'esbuild'` in `astro.config.mjs` (applied in the playground).
- **Todo:** report upstream to withstudiocms/studiocms. Document the workaround
  in user-facing install docs until fixed.

### 2. Public pages load StudioCMS dashboard CSS
- **Found:** 2026-10-02 · **Updated:** 2026-10-04 · **Affects:** studiocms 0.6.x · **Severity:** performance
- The production home page loads `DashboardLayout.*.css` (~54 KB) and
  `BaseLayout.*.css` (~13 KB). None of this comes from Tapestry.
- **JS part solved (2026-10-04):** the ~18 KB `page.*.js` was StudioCMS's "Quick Tools"
  corner menu. `injectQuickActionsMenu: false` had appeared not to work because it
  must be set under **`features`**; a top-level key is silently ignored. With
  `features.injectQuickActionsMenu: false`, public-page JS is 174 bytes.
- **Solved (2026-10-06):** traced to StudioCMS's middleware importing a dashboard
  component (#32); patched. Public pages now load only the site's own CSS. What's left:
  the 174-byte `page.js`, `astro-transition-event-polyfill`, which `@studiocms/ui` injects
  into every page (it fires `astro:page-load` when view transitions are off; the
  dashboard's scripts depend on it, and Astro can't inject a script into some pages only).

### 5. StudioCMS docs are out of date in places
- `studiocmsMinimumVersion` is documented but doesn't exist in 0.6.
- Hook name is `studiocms:astro-config`, not `studiocms:astro:config`.
- Plugin docs don't mention `componentRegistry` limitations for plugins.
- `injectQuickActionsMenu` lives under `features`, and unknown top-level keys are
  silently ignored (no validation error).
- **Policy:** verify against source; record in [research/studiocms-internals.md](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/research/studiocms-internals.md).

### 7. Direct database writes are hidden by StudioCMS's page cache
- **Found:** 2026-10-02 · **Affects:** dev workflow
- StudioCMS's SDK caches pages in memory (5 minutes by default, `sdk.cacheConfig`).
  `pnpm seed` writes to the database directly, so a running server may keep serving
  the old content until the cache expires or the server restarts.
- **Workaround:** the e2e suite resets content through the editor (JSON view + Save),
  which updates the cache. After `pnpm seed`, restart the dev server if needed.

### 8. Audit advisories without patches (reviewed, ignored)
- **Found:** 2026-10-02 · **Re-check:** 2026-11-01
- ~~`GHSA-ch52-4w7c-c8xp` (http-cache-semantics ≤ 4.2.0)~~: **resolved** 2026-10-08, the
  lockfile now resolves 4.3.0; the ignore entry is removed.
- `GHSA-vfj7-8cjw-p6xm` (braces ≤ 3.0.3): needs attacker-controlled glob patterns;
  StudioCMS's middleware only expands developer-defined route patterns.
- The remaining one is listed in `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` with these
  reasons. Remove each entry as soon as a patched version is available.

### 9. Editor lives on the "Page Content" tab, and the create screen has no editor
- StudioCMS shows page-type editors on the edit screen's **Page Content** tab, and
  not at all on the create screen. A new Tapestry page must be created, then edited.
- **Todo (Phase 3+):** consider an "Open Tapestry editor" shortcut or a dedicated
  full-screen editor route.

### 10. `GET.page.bySlug()` returns drafts, and the official blog route serves them
- **Found:** 2026-10-04 · **Affects:** studiocms 0.6.x SDK, `@studiocms/blog` 0.5.0 · **Severity:** security (information disclosure)
- `SDKCoreJs.GET.page.bySlug(slug)` has no draft filter (only list functions take
  `includeDrafts`). Routes that use it directly, like `@studiocms/blog`'s
  `[...slug].astro` and our playground route before this fix, serve draft pages
  to anyone who guesses the URL.
- **Fixed in Tapestry** with `getPage()` ([admin-bar.md](admin-bar.md)), covered by e2e.
- **Todo:** report upstream to withstudiocms/studiocms.

### 11. StudioCMS's Quick Tools "Edit" doesn't edit the current page
- Its Edit button links to the content list. The current URL is sent to
  `verify-session` but only logged. Superseded for Tapestry sites by the admin bar.

### 12. StudioCMS dev-toolbar "DB viewer" logs errors on every dev page
- **Found:** 2026-10-04 · **Diagnosed:** 2026-10-05 · **Affects:** dev only (studiocms 0.6.x)
- StudioCMS adds an Astro dev-toolbar app (`studiocms/dist/toolbar/db-viewer/viewer.js`)
  that queries `/studiocms_api/integrations/db-studio/query`. That endpoint
  intermittently returns 500, and the app logs `Error executing query: ParseError …`
  in the browser console. Not related to Tapestry; production has no dev toolbar.
- **More than noise (2026-10-06):** the app embeds an external site (DB Studio) in an
  iframe and passes it the local database; that site's own code logs
  `SELECT * FROM "main".sqlite_schema` and its headers cause the
  `Permissions-Policy: Unrecognized feature 'attribution-reporting'` warning. The query
  endpoint ran **any SQL for anyone in dev** (its only check was `import.meta.env.DEV`);
  the 500 comes from its database driver.
- **Fixed (patch, 2026-10-06):** the toolbar app isn't registered, and the endpoint
  requires the owner role in dev too. The e2e harness no longer ignores its errors, and the
  site suite checks that public pages log nothing.
- **Report upstream (when the user asks):** unauthenticated SQL endpoint in dev; external
  iframe receiving database contents.

### 13. Visual canvas limitations
- Component client scripts don't re-run after a live update (content is swapped in
  without executing scripts). Interactive islands are planned for Phase 5.
- In the canvas only, each component sits inside a `display: contents` wrapper.
  Flex/grid layout is unaffected, but CSS that targets direct children or uses
  structural pseudo-classes (`> *:first-child`) can differ from the public page.
- The canvas needs the site's page route to use `getPage()`, and the dashboard must
  be allowed to frame the site (same origin; no `X-Frame-Options: DENY`).

### 14. In dev, the site's global CSS leaks into the StudioCMS dashboard (light mode unreadable)
- **Found:** 2026-10-05 (user report) · **Affects:** dev server only · **Severity:** dev UX
- Symptom: after switching the dashboard to light mode, headings, tabs and links are
  black on a near-black background (measured contrast 1.12:1).
- Cause: in `astro dev`, dashboard pages load the global CSS of **every page route of
  the site**. Verified with a never-visited probe page whose `<style is:global>`
  appeared on `/dashboard` after a restart. It's not route matching, load order, or
  Tapestry's admin bar (each tested). The playground layout styles `body` and defines
  `--text`/`--background` (dark values when the OS is in dark mode). StudioCMS's light
  theme switches its text to black while `body` stays dark. StudioCMS's
  `auth-layout.css` also uses `var(--background)`/`var(--text)`, so the names clash.
- **Production is unaffected**: the built dashboard contains none of the site CSS, and
  light mode measures 19.6:1 contrast.
- **Mitigated in the playground (2026-10-05):** site styles are scoped to `.site` on
  `<body>` with `--site-*` variable names, so the leaked CSS matches nothing in the
  dashboard. Guidance for site authors: [defining components](guides/defining-components.md#site-css-and-the-studiocms-dashboard).
  An e2e step asserts light-mode contrast ≥ 4.5:1 on the dashboard edit page.
- After changing site CSS, **restart the dev server**: the dashboard kept serving the
  old copy of the leaked stylesheet until a restart.
- **Fixed (2026-10-06):** the cause was Astro's dev CSS collector walking through the
  manifest into every page (#32); with the Astro patch, the dashboard no longer gets the
  site layout's CSS in dev. (The Tapestry components' *scoped* styles still appear on the
  dashboard, because StudioCMS's component-registry tools import them; they can't match
  dashboard markup.) The scoping guidance stays good practice.

### 15. StudioCMS can create a page with an empty page type
- **Found:** 2026-10-05 (user report) · **Affects:** studiocms 0.6.1 · **Severity:** data integrity
- The create form's page-type select is hard-coded to `defaultValue="studiocms/markdown"`
  (`CreatePage.astro`). Without `@studiocms/md` installed that matches no option, so
  the field submits `""` and the "required" marker doesn't stop it. The server's
  `createPage` handler checks the title but not the page type (a code comment claims
  it's "validated at the API route level"). Result: a page with `package: ""`.
- Seen in the playground: page "Test One" (`bf7cf9fc-…`, slug `test-one`).
- **Mitigated (2026-10-05):** the playground now installs `@studiocms/md`, so the
  hard-coded default is a real option; the page-types e2e suite asserts this. The
  "Test One" page was deleted through the dashboard API.
- **Todo:** report upstream (the server should reject an empty or unknown page type).

### 16. StudioCMS's edit screen crashes for pages with an unknown page type, with no way to delete them
- **Found:** 2026-10-05 (user report) · **Affects:** studiocms 0.6.1
- `EditPage.astro` renders `editors[package]` without a fallback, so an unknown or
  empty page type throws "Unable to render CurrentEditorComponent because it is
  undefined". The Delete button lives on that screen, so the page can't be deleted
  from the UI. The same would happen if a page-type plugin were uninstalled.
- Workarounds: delete through the dashboard API (`deletePage` takes `{ id, slug }`),
  or set the page's `package` to an installed type, then delete it in the UI.
- **Todo:** report upstream (fallback editor or error message, and keep Delete reachable).

### 19. `@studiocms/html` editor fails to load in dev (works in production) · no longer applies
- **2026-10-06:** the HTML plugin was removed from the playground (user decision), along
  with this workaround. Kept for the upstream report.
- **Found:** 2026-10-05 · **Affects:** dev server only
- Its libraries ship files that only work after bundling: CodeMirror 5's UMD
  `htmlmixed` mode (`ReferenceError: CodeMirror is not defined`) and SunEditor's
  `src/langs/*.js` (no ESM default export, which fails the whole import silently).
  The dashboard showed a plain textarea instead of the editor.
- **Workaround (applied in the playground):** `vite.optimizeDeps.include` for
  `codemirror`, its `htmlmixed` mode and `suneditor`. The page-types e2e suite now
  waits for each plugin's real editor (`.TinyMDE`, `.sun-editor`, `.gjs-editor`).
- **Todo:** report upstream to StudioCMS.

### 20. `@studiocms/html` 0.4.x never saves what you type ("Error: No content found") · no longer applies
- **2026-10-06:** the HTML plugin and its local patch were removed (user decision). The fix
  below is kept for the upstream report.
- **Found:** 2026-10-05 (user report) · **Affects:** `@studiocms/html` 0.4.0–0.4.2, dev and production
- Reproduced: text typed into the editor appears there, but the `page-content` textarea
  stays empty, so Save stores `""`, and the site shows StudioCMS's fallback
  "Error: No content found".
- **Root cause: regression in 0.4.0** (2026-09-24), which moved from SunEditor 2 to 3 and
  rewrote the editor as a custom element. 0.3.0 synced the editor into the textarea with
  `editor.onChange = (contents, core) => { editor.save(); core.context.element.originElement.innerHTML = contents; }`;
  the rewrite dropped it.
- **Patched locally (2026-10-05):** `patches/@studiocms__html@0.4.2.patch` (registered in
  `pnpm-workspace.yaml` → `patchedDependencies`) adds SunEditor 3's
  `events.onChange` → `textarea.value = $.html.get()`. In SunEditor 3, content reaches the
  original textarea only via its own "save" command, which the plugin doesn't expose.
  The page-types e2e suite types into the editor, saves, and checks the database and
  the public page.
- **Todo:** report upstream with this fix; drop the patch when released. (pnpm fails
  the install if the patch stops applying after an upgrade.)
- Also harmless: SunEditor warns `exportPDF requires "apiUrl"` because the plugin enables
  all SunEditor plugins.
- Related: for **empty** pages, StudioCMS's renderer substitutes the string
  `<h1>Error: No content found</h1>` and passes it to the page type's renderer. The
  WYSIWYG renderer then tries to `JSON.parse` that text and shows "Error parsing
  content". (WYSIWYG was not investigated further at the user's request.)

### 21. StudioCMS "Edit History" reverts the whole stored page, not one version
- **Found:** 2026-10-05 · **Affects:** Tapestry pages with drafts (ADR 0011)
- StudioCMS's Edit History tab stores a diff of the content on every save and can
  revert to any of them. For a Tapestry page, the content is the whole stored page
  (published version, draft and history), so reverting there also rolls back
  **what's live** and the version list, and the change goes live immediately.
- **Guidance:** use Tapestry's **History** panel (Restore to draft, then Publish).
  It only changes the draft until you publish.

### 22. StudioCMS's public REST API returns stored page content verbatim
- **Found:** 2026-10-05 · **Affects:** studiocms 0.6.1 · **Severity:** security (information disclosure)
- `GET /studiocms_api/rest/v1/public/pages` and `/pages/{id}` need no login and
  return each page's raw stored content. There's no setting to turn this API off;
  it's on whenever authentication is enabled (`restAPIEnabled` in
  `dist/handlers/frontend/utils.js`). For Tapestry pages, that would expose the
  unpublished draft and the whole version history. Its router also accepts many
  spellings of the same path (`/pages/`, `//pages`, `/%70ages`, `/./pages`, `/pages;x`).
- **Fixed in Tapestry (2026-10-05):** plugin middleware redacts every JSON response
  for non-editors: the published version only, never-published pages hidden
  ([security.md](security.md#unpublished-content-drafts-and-history)). e2e-tested
  with several path spellings, and checked against the production build.
- **Todo:** report upstream (a setting to disable the public API, or a content
  filter hook for page types).

### 23. Concurrent reads make StudioCMS saves fail on SQLite ("database is locked" → HTTP 400)
- **Found:** 2026-10-05 · **Affects:** studiocms 0.6.1 with a local SQLite/libSQL file · **Severity:** reliability
- The playground database uses SQLite's default rollback journal (`journal_mode=delete`).
  While anything holds a read lock, StudioCMS's page update can't commit. StudioCMS
  maps the database error to a generic `DashboardAPIError`, so the editor gets
  **HTTP 400** and the save is lost (the editor shows StudioCMS's error toast).
- Found because the e2e helper polled the database while saving. After many
  overlapping polls, the dev server got stuck (logins returned 500) until it was restarted.
- **Handled in tests:** `saveAndWait()` waits for StudioCMS's save response
  instead of polling, and `storedContent()` retries `SQLITE_BUSY`.
- **Open question:** busy sites on a local SQLite file could hit this when a slow
  read overlaps a save. WAL mode (`PRAGMA journal_mode=WAL`) or a busy timeout would
  likely fix it; not verified with StudioCMS yet. Hosted libSQL/Turso is unaffected.
- **Todo:** report upstream.

### 24. StudioCMS toasts cover the editor toolbar for a few seconds after saving
- **Found:** 2026-10-05 · **Affects:** e2e only (cosmetic for people)
- StudioCMS's "Success" toast sits on top of the Tapestry toolbar's Publish button.
  A real mouse click there hits the toast. The e2e harness's `page.click()` now
  waits until the target element is actually the one under the pointer.

### 25. StudioCMS `usePluginData()` can't save (insert crashes, update is skipped)
- **Found:** 2026-10-06 · **Affects:** `@withstudiocms/sdk` 0.4.x in studiocms 0.6.1 · **Severity:** functional (plugin API)
- `SDK.PLUGINS.usePluginData(id, { entryId }).insert()` / `.update()` first look the
  entry up through the SDK cache (`memoize(cacheKey(id), select)`), then run the write
  through `memoize` with the **same key**. The cache already holds the lookup result,
  so the write never runs. For a new entry the cached result is `undefined`, and the
  cache's miss check only treats `null` as a miss (`returnNonNull`), so insert returns
  `undefined` and crashes with `Cannot read properties of undefined (reading 'id')`.
  For an existing entry, update returns the old entry and the database isn't changed.
- **Worked around in Tapestry (ADR 0014):** toolbar settings are read and written
  directly through `SDKCoreJs.dbService.db` (Kysely) in the same row
  `usePluginData()` would use, then `PLUGINS.clearPluginDataCache()` is called.
- **Todo:** report upstream (fix: invalidate the key before the write, and treat
  `undefined` as a cache miss).

### 26. Plugin dashboard page URLs replace dashes with underscores
- **Found:** 2026-10-06 · cosmetic · (Tapestry no longer uses `dashboardPages`; kept for reference)
- `route: 'text-formatting'` in plugin `@nascencestudio/tapestry` became
  `/dashboard/nascencestudio_tapestry/text_formatting` (`convertToSafeString`).

### 27. Plugin settings links in the sidebar are missing a slash (and can't match ids with a slash)
- **Found:** 2026-10-06 · **Affects:** studiocms 0.6.1 · **Severity:** functional
- The Plugins section links each plugin with a `settingsPage` to
  `routeMap.mainLinks.plugins + identifier`. `plugins` is built by
  `makeDashboardRoute("plugins/")`, which drops the trailing slash, so the link is
  `/dashboard/plugins@nascencestudio/tapestry`. Even with the slash, StudioCMS's own
  `plugins/[plugin]` page matches a single path segment, so any scoped package id
  (`@scope/name`) can't reach the generated settings page.
- **Handled in Tapestry (ADR 0014):** Tapestry serves its own page at both the
  linked URL and the intended one.
- **Todo:** report upstream (keep the slash; use a rest parameter or encode the id).

### 28. StudioCMS's "/dashboard/[...pluginPage]" route outranks plugins' "[dashboard]" routes
- **Found:** 2026-10-06 · **Affects:** studiocms 0.6.1 with any plugin dashboard page
- Once a plugin registers `dashboardPages` (the media library does), StudioCMS's catch-all
  plugin page route matches every `/dashboard/…` path. Astro ranks static segments first,
  so a route like Tapestry's `/[dashboard]/plugins/…` lost to it (404).
- **Handled:** Tapestry also registers its page under the literal `/dashboard/…` path
  (static, so it wins) and checks the request path against StudioCMS's dashboard route.

### 29. Media library: not yet supported
- **Noted:** 2026-10-06 · updated 2026-10-06 (captions, resized images, focal point,
  replace file and tags are done, ADR 0019)
- S3 storage (not wanted for now) and storing on more than one server.
- Captions for audio; AVIF copies; video posters, dimensions and duration; document page counts.

### 30. A bundled sharp can't find its native binary
- **Noted:** 2026-10-06 · ours (worked around)
- Astro (Vite/rolldown) bundles workspace packages into `dist/server`, including a
  static `import sharp from 'sharp'`; at runtime the bundled copy looks for
  `@img/sharp-<platform>` next to the bundle and fails ("Could not load the sharp
  module using the linux-arm64 runtime"). The dev server and unit tests don't show it.
- **Handled:** `images.ts` loads sharp with `createRequire` from
  `@nascencestudio/medialibrary/package.json` (its install location, where pnpm links
  sharp), lazily, and degrades to "no resized copies" if that fails. CI's docker job
  checks it inside the production image.

### 31. StudioCMS dashboard requests go to the configured site URL
- **Noted:** 2026-10-06 · StudioCMS behavior (not a bug for real use)
- The dashboard sends saves to the site URL from the Astro config, not the current
  origin, so a dev server on another port (e.g. `--port 4500`) shows "Transport error"
  toasts on save. Set `SITE_URL` to match when running a second server.

### 32. Dashboard CSS on every page (production) and every page's CSS on every page (dev)
- **Found:** 2026-10-06 (user report: dozens of `<style data-vite-dev-id>` tags on the
  public home page) · **Affects:** studiocms 0.6.1 with astro 7.3.5 · **Severity:** performance
- **Production:** the public page linked `DashboardLayout.css` (54 KB), `BaseLayout.css`
  (13 KB) and the media library's `library.css` (8 KB). Chain (traced in the build graph):
  public page → StudioCMS SDK/renderer/effect → `astro:config/server` or Astro's middleware
  helpers → `virtual:astro:manifest` → StudioCMS middleware → `studiocms:i18n` →
  `LanguageSelector.astro` → StudioCMS UI Button/Dropdown, whose CSS Vite bundles into the
  same files as the dashboard layout; Astro then attaches the whole files. Every route
  (even JSON endpoints) was tagged with them.
- **Dev:** Astro 7's dev CSS collector (`vite-plugin-css`) walks the full module graph,
  through the manifest into every page: ~100 `<style>` tags, 295 KB per public page.
- **Handled (patches, ADR 0021):** StudioCMS's middleware imports `defaultLang` from the
  plain config module (production fixed); Astro's dev collector stops at
  `virtual:astro:manifest` (dev fixed: 6 tags, 10 KB); the media library loads its
  dashboard CSS on demand instead of importing it in browser scripts (Astro's
  script-to-page mapping also crosses the manifest).
- **Report upstream (when the user asks):** StudioCMS (component imported by middleware),
  Astro (dev collector and script mapping cross the manifest).

### 33. @studiocms/md adds its CSS to every page
- **Found:** 2026-10-06 · **Affects:** @studiocms/md 0.5.0 · **Severity:** performance
- `injectScript('page-ssr', 'import "studiocms:md/styles"')` puts the heading-anchor and
  callout CSS (~1.9 KB) on every page, Markdown or not; no option turns it off
  (`callouts: false` only drops the callout part).
- **Handled (patch):** no global injection; the patch adds `studiocms:md/styles-inline`
  (the CSS as a string) and the site layout inlines it when
  `page.package === 'studiocms/markdown'`. See the admin-bar/site guide.

### 34. StudioCMS's 404 page is the dashboard layout
- **Found:** 2026-10-06 · **Affects:** studiocms 0.6.1 · **Severity:** performance, polish
- Without a site 404 page, StudioCMS injects its own `/404`, rendered in the full
  dashboard layout: ~190 KB per missing URL for anonymous visitors, including the
  dashboard's hidden "create user"/"invite user" forms (markup only; the actions still
  need a login). A site `src/pages/404.astro` alone collides with it (Astro warns that
  this becomes a hard error).
- **Handled:** the playground has its own `src/pages/404.astro` (site layout, ~1.5 KB in
  production) and sets `features.dashboardConfig.inject404Route: false`. Sites using
  Tapestry should do the same (site guide).

### 35. StudioCMS can't delete users (inverted ghost-user check)
- **Found:** 2026-10-07 (e2e cleanup) · **Affects:** @withstudiocms/sdk 0.4.2 · **Severity:** functional
- Deleting any real user fails with "User with ID … is an internal user and cannot be
  deleted.": `_isNotGhostUser` fails when the id is **not** the ghost user's (`!==`
  instead of `===`), so only the internal ghost user would be deletable.
- **Handled (patch):** the comparison is flipped (`patches/@withstudiocms__sdk@0.4.2.patch`).
  Report upstream (when the user asks).

### 36. Editor inputs inside StudioCMS's form can silently block Save
- **Found:** 2026-10-07 · **Ours** (fixed)
- Native form validation runs on the whole page form when StudioCMS submits it: an
  editor input with constraints (`min`, `max`, `step`, `required`) holding an
  out-of-range value makes the browser refuse to submit, and StudioCMS's Save does
  nothing visible. Hit with the schedule date input; latent in number fields.
- **Handled:** constrained editor inputs are detached from the form
  (`form="tapestry-detached"`); validation happens in the editor.

### 37. StudioCMS strips every `<script>` that components render
- **Found:** 2026-10-07 · **Upstream** (StudioCMS 0.6.1) · **Patched**
- `renderFn` (`dist/virtuals/components/renderFn.js`) runs `transformHTML()` twice more over the
  page's **rendered** output (augment components, storage URLs). `transformHTML()` always adds
  ultrahtml's sanitizer, and with default options it drops `<script>`. So Astro's island
  bootstrap and component `<script>`s (Astro 7 renders them inline where a component is used)
  never reach the page, for every page type. Islands render their HTML but never hydrate.
- **Workaround:** our StudioCMS patch lets a page-type renderer opt out of the sanitizer in those
  post-render passes (`componentScripts: true`); Tapestry opts in (its content can't contain HTML).
  Content is still sanitized before components are swapped in; other page types are unchanged.
  ADR 0030. The user approved reporting it (2026-10-08): issue text in
  [docs/upstream/studiocms-component-scripts.md](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/upstream/studiocms-component-scripts.md), to file once
  the project is on GitHub. Sites installing Tapestry apply the same fix with the patch it ships
  (`patches/studiocms@0.6.1.patch`, README).

## Resolved

### `@studiocms/wysiwyg` audit advisories (was #18)
- **Resolved:** 2026-10-05 by removing the plugin (user decision). It brought 21 advisories
  via `tui-image-editor` → `fabric@4` (including two dashboard XSS advisories with no
  compatible fix) and its public pages showed "Error parsing content" (see #20 note).
  `pnpm audit` is back to only the two reviewed advisories; the `canvas` build-script
  denial was removed along with it.

### First editor visit in dev reloaded the page (Vite dependency discovery)
- **Resolved:** 2026-10-05. Vite found the editor's browser dependencies (Preact,
  Pragmatic DnD) only on first load and reloaded the page ("optimized dependencies
  changed"). That caused a one-off e2e failure, and users got a surprise reload. The
  plugin now adds them to `vite.optimizeDeps.include` itself (`EDITOR_DEPS` in `index.ts`).

### The playground only offered the Tapestry page type (was #17)
- **Resolved:** 2026-10-05. Not a Tapestry override: StudioCMS ships no built-in page
  type. The playground now installs the official Markdown, HTML and WYSIWYG plugins
  alongside Tapestry. A page-types e2e suite creates, edits and renders each one.

### Inconsistent `@libsql/client` peers in studiocms 0.6.0 (was #4)
- **Resolved:** 2026-10-04. Upgraded to studiocms 0.6.1 (its database layer uses
  `@libsql/client` ^0.18) and removed the `peerDependencyRules` exception.
- *Correction (2026-10-05):* session 3 believed this upgrade also fixed a DB Studio
  500. It didn't; that error is intermittent dev-toolbar noise (see #12).

### Pinned `why-is-node-running@3.2.1` override (was #6)
- **Resolved:** 2026-10-04. Vitest 5.0.3 cleared the release-age gate; it pins 3.2.1
  itself, so the `overrides` entry was removed.

### Dashboard save round trip not verified (was #3)
- **Resolved:** 2026-10-02 (session 2). The browser e2e suite edits a page, clicks
  StudioCMS's **Save Changes**, checks the database holds exactly the editor's
  document, and checks the public page renders the edit.
