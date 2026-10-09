# StudioCMS internals (verified)

Findings from reading StudioCMS **0.6.0** source in `node_modules` (and the
0.6.1 tarball), checked against our tests. The official docs lag the code;
where they disagree, this file records what the code actually does.

_Last verified: 2026-10-04 against studiocms 0.6.1 (and 0.6.0), @withstudiocms/component-registry 0.2.x, @withstudiocms/sdk 0.4.x, ultrahtml 1.7.0._

## Plugin API

```ts
import { definePlugin } from 'studiocms/plugins';

definePlugin({
  identifier: '@scope/pkg',     // required
  name: 'Display Name',         // required
  requires?: string[],
  hooks: {
    'studiocms:astro-config': ({ logger, addIntegrations }) => {},
    'studiocms:rendering':    ({ setRendering }) => {},
    'studiocms:dashboard':    ({ setDashboard }) => {},
    'studiocms:frontend':     ({ setFrontend }) => {},
    'studiocms:auth', 'studiocms:image-service', 'studiocms:sitemap', ...
  },
});
```

- ⚠️ The docs mention `studiocmsMinimumVersion`; **it no longer exists** in 0.6
  (TypeScript rejects it).
- ⚠️ The docs write the hook as `studiocms:astro:config`; the real name is
  **`studiocms:astro-config`** (as used by `@studiocms/md`).
- Annotate a function that returns `definePlugin(...)` with
  `ReturnType<typeof definePlugin>`. The inferred type is too large for
  declaration emit (TS7056), and the exported `StudioCMSPlugin` type doesn't
  match `definePlugin`'s return type (optional fields differ).

## Page types (`studiocms:rendering`)

```ts
setRendering({
  pageTypes: [{
    identifier: 'tapestry/canvas',
    label: 'Tapestry (visual builder)',
    description?: string,
    fields?: [...],                  // extra form fields (checkbox, input, select, ...)
    rendererComponent: 'file:///…/renderer.js',
    pageContentComponent: 'file:///…/Editor.astro',
  }],
  augments?: [...],                  // per-page opt-in render augments
});
```

Paths are resolved module URLs (the official plugins use
`new URL(path, import.meta.url).toString()`).

### Renderer module

```ts
export default {
  name: string,
  renderer?: (content: string) => Promise<string>,  // returns HTML
  sanitizeOpts?: SanitizeOptions,                    // ultrahtml sanitize options
} satisfies PluginRenderer;                          // from 'studiocms/types'
```

### Editor component

Rendered inside the dashboard's **edit** page form with
`Astro.props.content` (the stored string). The form saves the value of
`<textarea name="page-content">` (`EditPageDataFromFormDataObjectSchema`
maps `page-content` → `content`). The **create** page doesn't render the
editor ("Editor is not available until page creation").

## Render pipeline

`StudioCMSRenderer` (`dist/virtuals/components/Renderer.astro`):

1. Finds the renderer by `page.package` (the page type identifier).
2. Calls `renderFn` → `createRenderer(result, sanitizeOpts, preRenderer)` from the component registry:
   - `html = await renderer(content)`
   - `transformHTML(html, components, sanitizeOpts)` runs ultrahtml with
     `[sanitize({...sanitizeOpts, allowComponents: true, allowCustomElements: true}), swap(components)]`.
3. Applies prefix/suffix/component augments enabled on the page, the storage API
   URL transformer, then post-processors.

### ultrahtml behaviors that matter

- **Attribute values are not entity-decoded.** `<x-a h="&quot;">` gives the
  component `props.h === '&quot;'` (verified by test). This is why Tapestry
  URL-encodes props (ADR 0004).
- **Attribute names keep their case** (`buttonLabel` stays `buttonLabel`).
- **`allowElements`** (non-empty) is a true allowlist: anything else is dropped,
  including its children.
- **`allowAttributes` doesn't remove unlisted attributes.** Only
  `dropAttributes` removes. (The type comment claims otherwise.)
- `script` is always dropped unless explicitly allowed.
- Names containing `-` are "custom elements"; names starting uppercase or
  containing `.` are "components".

### Component registry

- Configured in `studiocms.config` as
  `componentRegistry: Record<tagName, pathToAstroFile>`; paths are resolved by
  Astro's resolver relative to the project root. Absolute paths work.
- **Plugins can't add entries** (no hook for it), hence `tapestryComponentRegistry()`.
- The proxy (`createComponentProxy`) renders the component with
  `jsx(Component, { ...attributes, 'set:html': children.value })`, so children
  arrive as the **default slot**. Only the default slot is supported (re-checked
  2026-10-07 in component-registry 0.2.1: still `'set:html': children?.value`).
  Tapestry's named slots work around it: wrappers in the children HTML, split
  apart in `Node.astro` (ADR 0027). Astro accepts dynamic slot names there
  (`<Fragment slot={name} set:html={…} />`).
- After rendering, `renderFn` (`dist/virtuals/components/renderFn.js`) runs `transformHTML()`
  (always with ultrahtml's sanitizer, default options) twice more over the *rendered* output,
  which drops every `<script>` components emit (Astro islands, component scripts). Verified
  2026-10-07; patched opt-out per renderer (`componentScripts`): known issue #37, ADR 0030.
- The registry parses each component's `Props` interface for its own UI
  (`ComponentRegistryUI.astro`). That component has the nested `@keyframes`
  that breaks lightningcss (see known issues).

## Rendering a page on the frontend

StudioCMS doesn't route public pages itself (plugins like `@studiocms/blog` do).
A minimal catch-all route:

```astro
---
import { StudioCMSRenderer } from 'studiocms:renderer';
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
const page = await runSDK(SDKCoreJs.GET.page.bySlug(Astro.params.slug || 'index'));
if (!page) return new Response(null, { status: 404 });
---
<StudioCMSRenderer data={page} />
```

## Sessions, permissions and the public site

- StudioCMS's middleware fills `Astro.locals.StudioCMS.security.userSessionData`
  **only** for `/{dashboard}/**` and `/studiocms_api/**`. Public routes get nothing.
- To check the session on a public route, use StudioCMS's own auth module:
  ```ts
  import { User } from 'studiocms:auth/lib';
  import { Effect, runEffect } from 'studiocms/effect';
  const data = await runEffect(Effect.gen(function* () {
    const user = yield* User;
    return yield* user.getUserData(Astro); // { isLoggedIn, user, permissionLevel }
  }));
  ```
  Without the `auth_session` cookie it returns the default (logged-out) session with
  no database work. Invalid sessions get their cookie deleted.
- Permission levels: `owner > admin > editor > visitor` (plus `unknown`).
- Route map for links: `import { StudioCMSRoutes } from 'studiocms:lib'`
  (`mainLinks.dashboardIndex`, `contentManagement`, `contentManagementCreate`,
  `contentManagementEdit` + `?edit=<pageId>`, `authLinks.logoutURL`). Respects
  `dashboardRouteOverride`.
- **`SDKCoreJs.GET.page.bySlug(slug)` does not filter drafts** (only list functions
  take `includeDrafts`). `@studiocms/blog`'s routes use it unfiltered.
- **Quick Tools** (`dist/virtuals/scripts/user-quick-tools.js`): a `<user-quick-tools>`
  custom element injected as a `page` script into every non-dashboard page. On the
  first user interaction it POSTs `/studiocms_api/dashboard/verify-session` and, if
  logged in, shows a corner menu (Logout, Profile, Dashboard, Edit → content list).
  Disable with **`features.injectQuickActionsMenu: false`** (the top-level key is ignored).
- The SDK caches pages in memory (`sdk.cacheConfig`, 5 minutes by default).

## Rendering facts relevant to the canvas

- `Astro.locals` set by a page (e.g. via `getPage()`) **is visible inside
  registry-rendered components** (`Node.astro`): the component proxy renders with
  the page's `SSRResult`. That's how canvas mode reaches every node.
- An injected `.astro` route can render `<StudioCMSRenderer data={…}>` with a
  minimal page object `{ package, augments: [], defaultContent: { content } }`.
- In **dev**, Astro puts page-level component `<style>` tags at the start of a
  head-less page's output, which for the render endpoint means *inside* the
  content root. That includes StudioCMS dashboard CSS pulled in by the registry
  import chain. Production output is clean. The canvas strips these tags anyway.
- StudioCMS adds an Astro dev-toolbar app (`dist/toolbar/db-viewer/viewer.js`)
  that queries DB Studio on every dev page; it logs intermittent errors (known issue #12).

## Setup and auth facts

- Requires `output: 'server'` and an SSR adapter, plus at least one rendering
  plugin (otherwise: "No rendering plugins found").
- Env: `CMS_ENCRYPTION_KEY` (`openssl rand --base64 16`), plus database variables
  (`CMS_LIBSQL_URL=file:./studiocms.db` works for local SQLite).
- `studiocms migrate --latest` creates the schema.
- First-time setup: `/start` (step 1: site config; step 2: admin user), then
  set `dbStartPage: false`. Setup endpoints are `POST /studiocms_api/dashboard/step-1|step-2` (JSON).
- Usernames like `admin`/`root` are rejected.
- Login: `POST /studiocms_api/auth/login` with a **URL-encoded** form
  (`username`, `password`); multipart returns 500. Sets an `auth_session` cookie.
- Dashboard edit URL: `/dashboard/content-management/edit?edit=<pageId>`.

## Database tables (libSQL)

- `StudioCMSPageData`: `id, package, title, description, slug, contentLang, authorId, draft, …`
- `StudioCMSPageContent`: `id, contentId (→ PageData.id), contentLang, content`
- `StudioCMSUsersTable`

## Astro 7 notes

- `astro dev` starts a **background daemon**; use `astro dev stop|status|logs`.
- Vite 8 minifies CSS with lightningcss by default (strict parser).

## REST API (verified 2026-10-05, studiocms 0.6.1)

- Public, no login: `GET /studiocms_api/rest/v1/public/pages` (filters: `title`, `slug`,
  `author`, `parentFolder`) and `/pages/{id}` (refuses StudioCMS draft pages). Both return
  full page objects **including `defaultContent.content` and `multiLangContent[].content`
  verbatim**. Enabled whenever auth is enabled and the site isn't in demo mode
  (`restAPIEnabled` in `dist/handlers/frontend/utils.js`); there's no setting to turn it off.
  Tapestry redacts it with middleware (known issue #22).
- The API router is lenient with paths: `/pages/`, `//pages`, `/%70ages`, `/./pages`,
  `/pages;x` all reach the same handler. An unknown id answers 500, not 404.
- Secure API (`/studiocms_api/rest/v1/secure/…`) needs an API token.

## Page update handler (`frontend/pages/studiocms_api/_handlers/dashboard/content.ts`)

- `updatePage` (PATCH `/studiocms_api/dashboard/content/page`) maps every database error to a
  generic `DashboardAPIError` → **HTTP 400**. A `SQLITE_BUSY` during commit (e.g. another
  connection reading the rollback-journal SQLite file) therefore looks like a bad request
  (known issue #23). The playground DB's `journal_mode` is `delete`.
- When the site config has `enableDiffs`, each save also inserts a diff (start/end content):
  that's the "Edit History" tab.

## Content languages (verified 2026-10-07, studiocms 0.6.1)

- `StudioCMSPageContent` has one row per `contentLang`; `StudioCMSPageData.contentLang` is the
  page's default (`'default'`). The SDK's full page reads return all rows as `multiLangContent`
  and pick `defaultContent` by the page's `contentLang`.
- The dashboard's create/update handlers (`_handlers/dashboard/content.ts`) only ever use
  `contentLang: 'default'`; there is no UI or routing for other languages. Title, slug and
  description are page fields, so they can't vary by language. Tapestry uses one page per
  language instead (ADR 0032).
- Slugs may contain `/` (`fr/about`): stored as-is, kept by the edit form, served by a catch-all route.
- `SDKCoreJs.POST.page({ pageData, pageContent })` creates a page server-side; its insert schema
  wants booleans for `showOnNav`, `showAuthor`, `showContributors` and `draft` (0/1 in the table).

## Plugin dashboard pages, settings and data (verified 2026-10-06)

- `studiocms:dashboard` hook → `setDashboard({ translations, dashboardPages: { admin: [...] } })`.
  `translations` is required (`{ en: { '<component>': { ... } } }`). A page needs `title`
  (`{ en: '…' }`), `description`, `route`, `sidebar: 'single' | 'double'`,
  `pageBodyComponent` (a file path), optional `icon` (heroicons name) and
  `requiredPermissions`. URL: `/dashboard/<safe plugin id>/<safe route>`, where "safe"
  turns `@nascencestudio/tapestry` into `nascencestudio_tapestry` and dashes into underscores.
  The sidebar entry isn't a plain `<a>` link.
- `dashboardConfig.settingsPage: { fields, endpoint }` renders a generated form
  (checkbox, input, textarea, radio, select, rows), but defaults are static, so it
  can't show saved values. Saving goes to the plugin's own `onSave` handler.
- Plugin data: table `StudioCMSPluginData (id text primary key, data text)`.
  `SDKCoreJs.PLUGINS.usePluginData(pluginId, { entryId })` → `select/insert/update`
  (row id `${pluginId}-${entryId}`); insert/update are broken in 0.6.1 (known issue #25).
  `SDKCoreJs.dbService.db` is the raw Kysely client and works.
- The built-in Web Vitals plugin creates its own table at config time with
  `KyselyTableManager`, so plugins *can* add tables (ADR 0011 said otherwise, which was too strong).

### More dashboard facts (verified 2026-10-06, session 8)

- The **Plugins** sidebar section lists only plugins with a `settingsPage`, one
  `<a class="sidebar-plugin-link">` each, to `routeMap.mainLinks.plugins + identifier`.
  That URL is missing the slash after "plugins" (known issue #27), and StudioCMS's
  `plugins/[plugin]` route can't match scoped ids anyway. A plugin can serve its own page there.
- `settingsPage.endpoint` must point to a module exporting `onSave(ctx) => (request) => Response`;
  `fields: []` is accepted.
- `x-required-role: 'none'` (data middleware, `frontend/middleware/index.ts`) skips
  authentication entirely. Plugin `dashboardPages` with `requiredPermissions: 'none'`
  are left out of the Admin sidebar list, but they're then public.
- `studiocms/frontend/*` is exported: `layouts/DashboardLayout.astro` (props: `title`,
  `description`, `sidebar: 'single' | 'double'`, `lang`, `config` = `locals.StudioCMS.siteConfig`,
  `currentUser` = `locals.StudioCMS.security.userSessionData`; slots `header`,
  `double-sidebar`), `components/dashboard/PageHeader.astro` (`title`) and
  `components/dashboard/SidebarLink.astro` (`icon`, `href`). Pages under the dashboard
  path get StudioCMS's middleware (session in `locals`).
- The double-sidebar script requires `#back-to-outer` and `#show-page` elements in the
  inner sidebar (it throws otherwise).
- Plugin hooks don't receive StudioCMS's config, so a plugin can't know the dashboard
  path at config time; read it at request time from `StudioCMSRoutes.mainLinks.dashboardIndex`.

## Storage manager and dashboard page placement (verified 2026-10-06, session 11)

- StudioCMS's storage layer: a plugin hook (`studiocms:storage-manager`) or config
  `storageManager` supplies a driver handling `upload`, `list`, `delete`, `rename`,
  `download`, `publicUrl`, `resolveUrl`; content refers to `storage-file://<key>`
  (resolved through `StudioCMSStorageManagerUrlMappings`, for expiring signed URLs).
  Default driver: "Core No-Op Storage" (stores nothing). Only official driver:
  `@studiocms/s3-storage` (AWS SDK). The built-in `StorageFileBrowser` web component
  (System Management, page editor's URL generator) browses, uploads, renames, deletes.
  No media metadata, picker or usage tracking.
- Plugin `dashboardPages.user` with `requiredPermissions: 'editor'` appear in the main
  sidebar group (after Content Management and Taxonomy); `dashboardPages.admin` with
  `'admin'` under Admin. URL: `/dashboard/<plugin_id>/<route>` (underscored).
- Registering any dashboard page activates `/dashboard/[...pluginPage]`, which outranks
  routes whose first segment is a parameter (known issue #28).

## First-time setup routes and dashboard request URLs (verified 2026-10-06, session 13)

- `dbStartPage: true` injects the setup wizard (`frontend/setup-pages/`): pages `/start`,
  `/start/2`, `/done` and two JSON endpoints, `POST /studiocms_api/dashboard/step-1`
  (`{ title, description, defaultOgImage, siteIcon, enableDiffs, diffPerPage,
  loginPageBackground, loginPageBackgroundCustom }`; title and description required;
  `loginPageBackground` e.g. `studiocms-curves`) and `POST …/step-2`
  (`{ username, displayname, email, password, confirmPassword }`; username and password
  strength are checked). With `dbStartPage: false` the routes don't exist (404). The
  playground ties it to `CMS_SETUP=1`; `scripts/setup-site.mjs` drives both steps.
- The config file is evaluated by Node, so `process.env` works in `studiocms.config.mjs`.
- Dashboard API calls (e.g. the page save `PATCH /studiocms_api/dashboard/content/page`)
  go to the site URL from the Astro config, not the page's origin (known issue #31).
- SQLite (libSQL) `LIKE` has no default escape character; use `ESCAPE` (Kysely `sql`).

## Why dashboard CSS reached public pages (verified 2026-10-06, session 14)

- Astro 7: `astro:config/server` and `astro/dist/core/middleware` (via `manifest/ambient.js`)
  import `virtual:astro:manifest`, which imports every page (`virtual:astro:pages`) and the
  middleware. So nearly every module graph (StudioCMS SDK, renderer, `studiocms/effect`)
  contains the whole app.
- Production CSS: Astro walks **up** from each CSS module to pages, stopping at pages whose
  importers are all `virtual:astro:page:*` (`isBuildCssBoundary` in `plugin-css.js`). The
  middleware isn't a page, so CSS imported by the middleware's graph reaches every page; and
  Astro attaches whole CSS **files** (chunks), so one shared component's CSS drags in
  everything bundled with it.
- StudioCMS's middleware imported `defaultLang` from `studiocms:i18n`, a virtual module that
  also exports `LanguageSelector.astro` (StudioCMS UI Button + Dropdown). Their CSS shared
  chunks with `DashboardLayout`/`BaseLayout`.
- Dev CSS: `vite-plugin-css/index.js` (`collectCSSWithOrder`, `ensureModulesLoaded`) walks
  **down** the whole graph with no page boundaries (not `vite-plugin-astro-server/vite.js`'s
  `crawlGraph`, which no longer collects CSS in Astro 7).
- Browser-script CSS: assigned via `pagesByScriptId` (scripts the analyzer thinks a page
  includes), which also crosses the manifest.
- `@studiocms/md` injects `studiocms:md/styles` with `injectScript('page-ssr')`;
  `@studiocms/ui` adds `astro-transition-event-polyfill` with `injectScript('page')`.
