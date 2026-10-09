# Security

_Last updated: 2026-10-06 (session 11: media library, Docker)._

Security is a primary design goal, alongside speed and small size. This
document covers the threat model, the defenses in the code, and the
supply-chain policy.

## Threat model

| Actor | Can | We must prevent |
| --- | --- | --- |
| Anonymous visitor | Request any public page | Injected script or markup reaching them via page content; resource exhaustion via crafted pages |
| Editor (authenticated, low trust) | Write any string into page content, including bypassing the editor UI and posting raw JSON | Stored XSS, breaking out of the component model, server resource exhaustion |
| Developer (trusted) | Write components and config | Accidental foot-guns, e.g. a prop named `onclick` spread onto an element |
| Compromised dependency | Run code at install or build time | Malicious install scripts; hijacked package versions |

**Page content is untrusted input.** The editor UI is a convenience, not a
security boundary: anything an editor can save is assumed to be hostile.

## Defenses in the render pipeline

Layered so that a bug in one layer doesn't become an exploit:

1. **Schema validation** ([`validate.ts`](../src/validate.ts)).
   Only registered component types; only declared props; every value
   type-checked; strings length-limited; `url` props restricted to relative
   URLs or `http`, `https`, `mailto`, `tel` (scheme detection ignores
   whitespace and control characters, so `java\tscript:` is caught).
   Own-property lookups only (`Object.hasOwn`), so `__proto__` and
   `constructor` can't be used as types or props.
2. **Resource limits.** 1 MB of content, depth 32, 2,000 nodes. Checked
   before and during the tree walk.
3. **Encoding.** Props are serialized as URL-encoded JSON, which contains no
   `"`, `&`, `<` or `>`; the `type` attribute is escaped as well. Tests check
   that attribute breakout is impossible.
4. **Element allowlist.** StudioCMS sanitizes our output with
   `allowElements: ['tapestry-root', 'tapestry-node']`; any other element is dropped before
   components are swapped in. (Note: ultrahtml's `allowAttributes` doesn't strip
   unlisted attributes, so layer 1 is the attribute guard.)
5. **Astro auto-escaping.** Components render props through Astro
   expressions, which escape text. Components should never pass props to
   `set:html` unless the prop type is designed for sanitized HTML (none are yet).
6. **Definition-time guards** ([`define.ts`](../src/define.ts)).
   Prop names starting with `on`, and `class`, `style`, `id`, `slot`, `is`,
   `children`, `key`, `ref`, are rejected, so a component that spreads
   `Astro.props` can't receive an event-handler attribute.
7. **`Node.astro` re-checks the type** against the component map and refuses
   to render anything whose props fail to decode.

## Draft visibility and the admin bar

See [admin-bar.md](admin-bar.md) and [ADR 0009](decisions/0009-server-rendered-admin-bar.md).

- **Drafts are private.** StudioCMS's `GET.page.bySlug()` returns drafts, so routes
  using it directly leak them (known issue #10). `getPage()` returns `null` (→ 404)
  for drafts unless the viewer is an editor. A 404, not a 403, so a draft's existence
  isn't revealed. Covered by e2e (anonymous, forged cookie, editor).
- **Session checks reuse StudioCMS's code** (`User.getUserData()`), fail closed
  on errors, and treat invalid or forged cookies as anonymous.
- **No caching of admin views.** Every response rendered for an editor is
  `Cache-Control: private, no-store`; drafts are also `X-Robots-Tag: noindex, nofollow`.
- **Nothing for anonymous visitors.** The admin bar's markup and CSS are emitted
  only for editors, so there's no attack surface or payload for anyone else.
- **CSP note.** The bar's inline `<style>` requires `style-src 'unsafe-inline'` or a
  nonce on editor responses.

## Rich text

See [ADR 0012](decisions/0012-rich-text.md).

- **No HTML is stored or rendered from strings.** Rich text is a JSON tree.
  `RichText.astro` renders it through `toRenderTree()` into elements from a fixed
  list (`p h1–h6 blockquote ul ol li br hr strong em u s sub sup a`). Text and the
  only attributes are escaped by Astro: `href` (checked with `isSafeUrl()`) and, for
  alignment, `style="text-align: …"` built from four fixed values (anything else is
  dropped, so the attribute can't carry other CSS). No `set:html`.
- **CSP note:** alignment uses a `style` attribute, which a strict Content-Security-Policy
  blocks unless `style-src-attr 'unsafe-inline'` (or `style-src 'unsafe-inline'`) is allowed.
  Without it, aligned text falls back to the default alignment; nothing else breaks.
- **One cleaner everywhere.** `cleanRichText()` runs in the validator (every
  render and the canvas endpoint), in the editor and in the JSON view: only the
  field's toolbar formatting survives, links must pass `isSafeUrl()` (the same
  scheme check as `url` props, including `java\tscript:` tricks), link attributes
  other than `href` are dropped, unknown nodes are dropped, and values over
  20,000 characters of text, 2,000 nodes or depth 8 are rejected. `toRenderTree()`
  cleans again and re-checks every `href`, so it's safe even on unvalidated input.
- **Paste.** The editor's ProseMirror schema only contains the toolbar's nodes
  and marks; pasted HTML is parsed into that schema (scripts, images, event
  handlers, tables and disallowed formatting are dropped) and pasted links with
  unsafe schemes are refused. ProseMirror parses clipboard HTML in a detached
  document, so nothing in it runs. The e2e suite pastes hostile HTML and checks
  nothing executed and nothing unsafe was kept.
- **Adversarial tests:** unit tests for unsafe schemes, extra attributes,
  prototype keys, unknown nodes, limits and the tag allowlist; e2e for paste,
  the link form, and hostile JSON applied in the editor.

## Media library

See [ADR 0016](decisions/0016-media-library.md). Uploads are the riskiest input
in the system, so they get several independent layers:

- **Who:** the API (`/_media/api/*`) requires a StudioCMS session at editor level
  or above (fail closed); changing requests must come from the same origin (CSRF).
- **What:** the file type is detected from the file's first bytes and must agree
  with the extension; only allowlisted formats are accepted (no HTML, scripts,
  executables, archives). Text documents must be valid UTF-8 without control bytes.
- **How much:** per-kind size limits (defaults: image 10 MB, video 200 MB, audio 100 MB,
  document 25 MB), enforced while streaming (the body never sits in memory whole).
  Admins can change them in the dashboard ([ADR 0018](decisions/0018-media-upload-settings.md)),
  but only between 1 MB and the developer's ceiling (`maxUploadSize`, default 1 GB,
  `MEDIA_MAX_UPLOAD_MB`); stored values are clamped again on every read. Caddy caps
  request bodies at the same ceiling. The settings endpoint (`/_media/settings`) is
  admins only, same-origin, 8 KB, and refuses invalid values instead of guessing.
- **SVG switch:** admins can turn SVG uploads off; the server then refuses `.svg`
  before reading the content. SVG markup under another name never becomes an image
  (content must match the extension; as `.txt` it's a text download).
- **SVG:** rebuilt from an allowlist (`svg.ts`): no scripts, event handlers,
  `foreignObject`, animations, links, embedded images, DOCTYPE/entities (no XXE);
  references only within the file (`#id`, `url(#id)`); CSS kept only without
  external references. Tested with 18 known attack patterns.
- **Where:** stored under random ids (`YYYY/MM/m_<16 chars>.<ext>`); every storage
  path is checked against that exact pattern and must stay inside the storage
  directory (no path traversal); the original name is only a label.
- **Serving:** `/files/…` serves only that key pattern, with the type from the
  extension, `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; …; sandbox`, so an SVG or PDF opened
  directly can't run script on the site's origin. Office and text files download
  (`Content-Disposition: attachment`).
- **Remote videos:** only YouTube/Vimeo URLs whose video id passes a strict pattern;
  every URL we emit (embed, oEmbed, thumbnail) is rebuilt from that id. oEmbed is
  fetched with a 5 s timeout and no redirects; thumbnails only from `i.ytimg.com` /
  `i.vimeocdn.com`. Embeds use youtube-nocookie.com and Vimeo's do-not-track.
- **Content references:** components and rich text store media **ids** (validated
  pattern), never URLs; rendering looks the item up server-side.
- **Database:** parameterized Kysely queries only; `LIKE` searches (name, tag, usage)
  escape `%`, `_` and `!` with an explicit `ESCAPE '!'` (SQLite has no default escape,
  so the earlier backslash escaping didn't work; fixed 2026-10-06).
- **Replacing a file** ([ADR 0019](decisions/0019-media-editing-extras.md)): the same
  checks as an upload, plus the same kind as before; the new file gets a new random
  key (no overwriting, no stale caches); the old files are removed afterwards.
- **Captions:** `.vtt`/`.srt` up to 2 MB, valid UTF-8 without control bytes, **rebuilt**
  (`subtitles.ts`): normalized timings, known cue settings only, only WebVTT's cue tags,
  `-->` in text neutralized, STYLE/REGION/NOTE blocks dropped (STYLE CSS could fetch
  outside URLs). Language codes and labels are validated; served as `text/vtt` with
  `nosniff` and the sandbox CSP. Tested with script tags, event handlers, tracking CSS,
  fake timings and broken encodings.
- **Resized images:** only JPEG/PNG/WebP/AVIF reach the decoder (never SVG; GIF is
  skipped); `limitInputPixels` 100 MP against decompression bombs, `failOn: 'error'`,
  one image at a time, no cache; metadata (GPS, camera) isn't copied to the WebP copies.
  Fixed widths only (no on-demand resizing endpoint to abuse). The admin backfill is
  admins-only, same-origin and time-boxed.
- **Stored JSON** (tracks, variants) and tags are validated again on every read; a
  storage key must match the key pattern before it becomes a URL.

## StudioCMS dev tooling

StudioCMS's dev-toolbar "Database Viewer" sent the local database to an external site in
an iframe, and its query endpoint (`/studiocms_api/integrations/db-studio/query`) ran
arbitrary SQL for **unauthenticated** requests whenever the dev server was running (a
risk with `--host` on a shared network, or from other sites in the same browser). Our
StudioCMS patch removes the toolbar app and requires the owner role for the endpoint in
dev as well (known issue #12).

## Publishing controls (ADRs 0022, 0023)

- **Publish permission:** with `publishPermission: 'admin'|'owner'`, saves by lower
  roles are rewritten in Tapestry's middleware so the live version, history and
  schedule stay exactly as stored (read from the database, not the page cache); only
  their working copy is saved, as the draft. Matched by request body (dashboard and
  REST shapes), not URL. Covers publishing, unpublishing (empty content), forged
  history/schedules and the old single-document format; saves of Tapestry-looking
  content that can't be tied to a page are refused (403). Tested with crafted requests.
- **Scheduled versions** are never public before their time: the renderer, `getPage()`
  and the JSON redaction all apply a schedule only once due; public JSON contains only
  the published document (never `scheduled`).
- **Version parameter** (`?tapestry-version=…`) works for editors only and is ignored for
  visitors; responses are `noindex` and `private, no-store`.

## Link props (ADR 0025)

- Stored values pass `cleanLinkValue()`: page ids match `[A-Za-z0-9_-]{1,64}`, web
  addresses follow the `url` rules (no `javascript:`/`data:`, also when hidden with
  whitespace or control characters), anything else is dropped. Adversarial unit tests.
- Components get a resolved `href`, never the stored object; new-tab links carry
  `rel="noopener noreferrer"`.
- A link to a **draft** page resolves to `null` for visitors, so a draft's path and
  title never appear on public pages; deleted pages also give `null`.
- **`GET /_tapestry/pages`** (the editor's page list) is editors only (403 otherwise),
  read-only, `private, no-store`, and returns only id, title, path and the draft flag.

## List and object props (ADR 0026)

- Every field inside an object or list item goes through the same cleaning as a
  prop (URL rules, rich text allowlist, length limits, canonical links).
- Bounded cost: at most 100 items per list (default 50), one level of nesting;
  the document's size, node and depth limits still apply.
- Objects are rebuilt from the definition's field names, so unknown keys
  (including `__proto__`) never reach components. Adversarial unit tests.

## Named slots (ADR 0027)

- Slot names are checked with `Object.hasOwn` against the definition and must match
  `^[a-zA-Z][a-zA-Z0-9]*$`, so prototype keys never match.
- `<tapestry-slot>` wrappers come only from the renderer. `splitSlots()` honors only
  top-level, balanced wrappers with a valid name; anything else stays in the default
  area as HTML that was already rendered. Content can't forge a wrapper: text and
  attribute values are HTML-escaped, and nested components' wrappers were consumed
  when they rendered. Adversarial unit tests.

## Patterns (ADR 0028)

- `/_tapestry/patterns` is editors only (403 otherwise), `private, no-store`. POST and
  DELETE require a same-origin `Origin` (CSRF) and bodies ≤ 200 KB.
- Saved components are validated against the manifest on save and again on every read
  and insert (fresh ids, unknown components and props dropped), like clipboard content.
- Ids are `pt_` + 16 base-36 characters (checked before any lookup); names are plain text
  with control and bidi-override characters removed.
- Delete: the author or an admin. Patterns can't change live pages (inserting edits the draft).
- Limits: 100 patterns, 100,000 characters each.

## Library previews (ADR 0029)

- Previews come from the editors-only render endpoint and are shown in an
  `<iframe srcdoc sandbox="allow-same-origin">`: no scripts run in it. Its head holds
  only the canvas page's own stylesheets; drop zones and page-level tags are removed.
- Thumbnails are build-time image files (extension checked in `defineComponent()`),
  bundled by Vite and shown with `<img>` (SVG scripts don't run there).

## Islands and component scripts (ADR 0030)

- StudioCMS re-sanitizes rendered output with defaults that drop all `<script>`s (#37). Our
  patch lets Tapestry's renderer (`componentScripts: true`) keep the scripts components emit.
  Safe because Tapestry content can't contain HTML: the validator and Astro's escaping keep
  text, attributes and URLs inert, and the renderer's own output is still sanitized before
  components are swapped in. Other page types keep the old behavior.
- e2e checks `<script>`, `onerror` and `javascript:` payloads in text props, button links and
  island props stay inert on a public Tapestry page.
- The canvas runs scripts from the editors-only render endpoint (same components as the page)
  once each; content can't add scripts there either.
- Island props are serialized into the page (visible in the source): only ever pass data the
  page may show.

## Translations (ADR 0032)

- `/_tapestry/translations` is editors only; creating (POST) needs a same-origin `Origin`, a
  configured language and an existing Tapestry source page. New translations start
  **unpublished** (getPage() 404s for visitors until published).
- `getPage().translations` only lists, for visitors, versions that are published and not
  StudioCMS drafts; localized page links fall back to the original otherwise, so a
  translation's slug never leaks early.
- Language codes and rows are validated (`parseLanguages`, `parseLanguageRow`).

## Component permissions (ADR 0033)

- `guardSaves()` (middleware) checks every JSON save of Tapestry content by a user who has
  locked components: each saved document (working copy, live, scheduled) must leave locked
  components exactly as in some version already stored (read from the database); otherwise 403.
  Covers crafted requests on any path spelling, the REST API shape and new pages.
- The editor's locks (role from `data-user-level`) are a courtesy; the server rule is the guard.
- Unit tests cover add/remove/change/move/re-type and version restores; e2e sends a crafted
  change as an editor.

## Deployment (Docker)

See [ADR 0017](decisions/0017-docker-deployment.md) and the [deployment guide](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/guides/deployment.md):
non-root container, read-only root filesystem, all capabilities dropped,
`no-new-privileges`; the app isn't exposed directly (Caddy: HTTPS, HSTS and other
headers); secrets only in `.env.production` (never in the image). Astro trusts
`X-Forwarded-*` only for the configured domain (`security.allowedDomains`).

## Inline canvas editing and admin toolbar settings

See [ADR 0013](decisions/0013-inline-canvas-editing.md) and [ADR 0014](decisions/0014-admin-toolbar-settings.md).

- **Canvas text markers** (`<tapestry-canvas-text>`) are emitted only in canvas
  mode, which only editors can switch on. Public pages never contain them (e2e-checked).
- **Inline edits use the same editor core** as the settings field: the same
  schema (toolbar allowlist), paste rules and link validation, and they're committed
  to the same store, so the validator and renderer treat them like any other edit.
- **The settings page** (Plugins → Tapestry, served at `/<dashboard>/plugins@nascencestudio/tapestry`
  and `/<dashboard>/plugins/@nascencestudio/tapestry`) checks the session itself: anonymous →
  login, below admin → dashboard home; it answers 404 under any path other than the
  real dashboard and is `private, no-store`.
- **`POST /_tapestry/settings`** (toolbar settings): same-origin `Origin` check,
  StudioCMS session at admin or owner level (fail closed), 64 KB limit, input
  cleaned against the manifest (unknown fields and buttons dropped, never more
  than the developer's toolbar), and it only redirects to same-origin paths.
  e2e covers anonymous, forged-session and cross-origin requests and off-site redirects.
- **The developer's toolbar stays the security boundary.** Admin settings only
  remove editing options; the public renderer always cleans against the developer's
  list, so a settings mistake can't enable anything the code doesn't allow.
- Settings are read with a parameterized query through StudioCMS's Kysely client.
  The stored JSON is re-cleaned on every read.

## Unpublished content (drafts and history)

See [ADR 0011](decisions/0011-draft-publish-history.md). A Tapestry page's stored
content holds the published version, the draft and earlier versions together, so
every path that hands out stored content must reduce it to the published version
for non-editors:

- **Rendering:** the page-type renderer renders only `published`. `getPage()`
  serves the draft only to editors who ask for it (`?tapestry-preview` or the
  canvas). Those responses are `no-store` and `noindex`, and never-published pages
  are a 404 for visitors (e2e-tested).
- **StudioCMS's page cache:** `getPage()` builds a *copy* of the cached page object
  with the chosen document. Changing the cached object would serve an editor's
  preview to the next visitor. An e2e step checks visitors right after a preview.
- **JSON responses:** StudioCMS's anonymous REST API
  (`/studiocms_api/rest/v1/public/pages[/id]`) returns stored content verbatim, and
  there's no setting to disable it. Without a fix, anyone could read every draft
  and the whole history (verified 2026-10-05). The plugin's middleware
  (`runtime/middleware.ts`) redacts **any** JSON response for non-editors:
  stored content becomes the published document, and never-published pages are
  dropped or answered with 404.
  - It matches on content, not URLs. StudioCMS's router also answers `/pages/`,
    `//pages`, `/%70ages`, `/./pages` and `/pages;x`, so a path allowlist would
    be easy to get around. The e2e suite checks several of these spellings.
  - It fails closed: if redaction throws, the response is a 500, never the raw body.
  - Editors (dashboard session) get responses unchanged. Token-only REST clients
    are treated as non-editors.
- **Stored content stays untrusted:** every document in it, history included,
  is validated on read. Total size is capped at 1 MB × (`historyLimit` + 2).

## Visual canvas

See [ADR 0010](decisions/0010-visual-canvas.md).

- **`/_tapestry/render`** accepts only `POST`, only from the same origin (the
  `Origin` header must match: CSRF protection), only from editors (StudioCMS
  session check, fail closed), and only up to the document size limit. Its input
  goes through the normal validator and renderer, so it can't render anything a
  saved page couldn't. Responses are `no-store` and `noindex`.
- **Canvas mode** (node markers, no admin bar) is enabled only for editors; the
  `?tapestry-canvas` parameter is ignored for everyone else (e2e-tested).
- The canvas iframe is same-origin (it's the site itself) and isn't sandboxed:
  the editor needs DOM access, and the page's scripts are the site's own trusted
  code. Navigation, link clicks and form submissions inside the canvas are blocked.
- The live swap imports server-rendered markup from our own endpoint into the
  iframe; `<script>` elements are stripped and nothing is executed.

## Defenses in the editor

The editor is a convenience for trusted-but-fallible editors, not a security
boundary (the renderer re-validates everything). Still, it must not corrupt
content or leak data into StudioCMS:

- **No silent rewrites.** Opening a page never writes to the content field. Only an
  actual edit does. Unreadable content opens in the JSON view and stays untouched
  until valid JSON is applied.
- **Validated JSON apply.** Pasted JSON goes through `parseDocument()`; invalid JSON
  or an unknown version is refused outright rather than replacing the page with an
  empty document.
- **No form leakage.** StudioCMS saves any unknown *named* form field as plugin
  data. Editor controls have no `name` attributes, so search text and
  half-typed values never get persisted.
- **No accidental saves.** All editor buttons are `type="button"`; Enter in a
  single-line input is suppressed (implicit form submission would save the page).
- **Scoped shortcuts.** Undo/redo only act on events from inside the editor or
  `<body>`, never in text fields, so other dashboard inputs keep native undo.
- **Dashboard-only code.** The editor bundle (about 35 KB gzipped on first load, including the
  canvas, plus a 67 KB rich text chunk loaded on demand) is loaded only by the
  authenticated edit page; public pages don't include it (verified in the
  production build: public pages still load only Astro's 174-byte script).

### Guidance for component authors

- Render props as text (`{heading}`), never with `set:html`.
- Use `url` props for anything placed in `href`/`src`. Never use `text`.
- If you spread props onto elements, spread only known keys.
- Links that open new tabs: add `rel="noopener noreferrer"` (see the playground's `Button.astro`).

## Supply-chain policy

Configured in [`pnpm-workspace.yaml`](../pnpm-workspace.yaml). Rationale: [ADR 0003](decisions/0003-pnpm-and-supply-chain-hardening.md).

| Setting | Value | Effect |
| --- | --- | --- |
| package manager | pnpm only | Strict, non-flat `node_modules`: packages can only import what they declare |
| `minimumReleaseAge` | 3 days | Versions younger than 3 days are never installed |
| `trustPolicy` | `no-downgrade` | Fail if a version has weaker provenance than earlier ones (possible account takeover) |
| `trustPolicyIgnoreAfter` | 180 days | The trust check applies only to versions from the last 180 days |
| `blockExoticSubdeps` | true | Transitive dependencies only from the registry (no git or tarball URLs) |
| `strictDepBuilds` + `allowBuilds` | allowlist | Install scripts run only for listed packages (esbuild, sharp) |
| `saveExact` | true | Exact versions in `package.json` |
| `engineStrict` | true | Enforce `engines` |
| `verifyDepsBeforeRun` | error | Scripts refuse to run if `node_modules` doesn't match the lockfile |

Every exception (`overrides`, `peerDependencyRules`, denied builds, ignored
advisories) is documented inline with its reason and an exit condition.

### Runtime dependencies of the plugin

| Package | Version | Where it runs | Provenance | Notes |
| --- | --- | --- | --- | --- |
| `preact` | 10.29.8 | Dashboard editor | ✓ | |
| `@preact/signals` | 2.11.2 | Dashboard editor | ✓ | |
| `@atlaskit/pragmatic-drag-and-drop` | 4.0.0 | Dashboard editor | ✗ | Atlassian publishes without provenance; see ADR 0007 for mitigations |
| `@atlaskit/pragmatic-drag-and-drop-hitbox` | 3.0.0 | Dashboard editor | ✗ | Same |
| `ultrahtml` | 1.7.0 | Media library server (SVG parsing) | ✓ | No dependencies; already used by StudioCMS |
| `sharp` | 0.35.5 | Media library server (resized images) | ✓ | Prebuilt libvips binaries per platform (`@img/*`, all with provenance); no install scripts; loaded at runtime only if available (ADR 0019) |
| `kysely` | 0.29.6 | Media library server (`sql` for `LIKE … ESCAPE`) | ✓ | No dependencies; the version StudioCMS already installs |
| `prosemirror-model`, `-state`, `-view`, `-transform`, `-commands`, `-keymap`, `-history`, `-schema-list` | see ADR 0012 | Dashboard editor (rich text field, loaded on demand) | ✗ | One maintainer (the project's author); never published with provenance; no outside dependencies |

None of these load on public pages.

### Audit status

`pnpm audit` is clean except for one reviewed advisory (braces, `auditConfig.ignoreGhsas`,
re-check 2026-11-01). `source-map-js` is forced to 1.2.2 with an `overrides` entry
(GHSA-68fv-2mgg-jv7q, build-time only) until its parents pick up the fix. The `@studiocms/wysiwyg` plugin was tried and **removed** on
2026-10-05 because it brought 21 advisories (fabric@4 chain). Tapestry and the
Markdown plugin add none. The `@studiocms/html` plugin and its local patch were removed
on 2026-10-06 (no patched dependencies remain).

## Secrets

- This repository has no secrets: publishing uses npm trusted publishing (no token after the
  first release), and every release is approved with 2FA (ADR 0035).
- In the playground repository, `.env` holds `CMS_ENCRYPTION_KEY` and database settings and
  `.dev-credentials` the local dev admin login (both gitignored, `chmod 600`); its seed script
  refuses to run against anything except a local `file:` database.

## Open items

- Previewing *saved* drafts is done (`?tapestry-preview`, editors only). Sharing
  a preview with someone who has no account (signed, expiring links) isn't built yet.
- Consider a Content-Security-Policy recommendation for sites using Tapestry.
