# Roadmap

_Last updated: 2026-10-06._

Guiding principle: **start small, ship vertical slices**. Every phase ends with
something that works end to end in the playground, has tests, and is documented.

## Phase 0: Foundation ✅ (2026-10-02)

- [x] pnpm monorepo: `packages/tapestry` (plugin) and `playground` (site)
- [x] Supply-chain hardening in `pnpm-workspace.yaml`
- [x] TypeScript 6 strict, Biome, Vitest
- [x] Playground: Astro 7 + StudioCMS 0.6 + libSQL (local SQLite file)
- [x] Docs: CLAUDE.md, architecture, data model, security, ADRs, devlog

## Phase 1: Render pipeline ✅ (2026-10-02)

Goal: a page stored as a component tree renders as real Astro components.

- [x] Document format v1 and `defineComponent()` with six prop types
- [x] Validator with limits, URL safety, never-throw cleaning
- [x] Renderer: `<tapestry-node>` and URL-encoded props, `Node.astro` wrapper
- [x] StudioCMS page type `tapestry/canvas` (renderer and editor)
- [x] Phase 1 editor: JSON textarea, live validation, component reference
- [x] Six example components in the playground and a seed script
- [x] 75 unit tests, including the real ultrahtml pipeline
- [x] Verified: dev render, dashboard editor load, production build and render
- [x] Dashboard save round trip verified in a real browser (e2e, Phase 2 session)

## Phase 2: Visual editor MVP ✅ (2026-10-02)

Goal: an editor can build a page without touching JSON.

- [x] UI clean-up (2026-10-07): Components panel in StudioCMS purple, icon buttons and purple markers in the page structure, keyboard hints in info popovers, canvas bottom toolbar

- [x] Evaluated Puck → build our own ([ADR 0006](decisions/0006-build-our-own-editor-not-puck.md))
- [x] Chose drag and drop: Pragmatic DnD + list-item hitbox ([ADR 0007](decisions/0007-drag-and-drop-library.md))
- [x] Preact 10 + `@preact/signals` mounted from `Editor.astro` (dashboard-only, ~22.5 KB gzipped)
- [x] Store: document signal, selection, immutable tree ops, undo/redo with typing coalescing
- [x] Component library panel (grouped by `category`, searchable, click or drag to add)
- [x] Layer tree: drag to reorder and nest, respecting `acceptsChildren` and blocking cycles
- [x] Props panel generated from the prop schema, with inline validation
- [x] Keyboard: select, move, indent/outdent, delete, duplicate, undo/redo; `aria-live` announcements
- [x] Writes the document into `textarea[name=page-content]` (only after the first edit)
- [x] JSON view (validated apply; repairs unreadable content)
- [x] Unit tests for tree ops and the store (29 new); browser e2e harness and a 14-step editor suite ([ADR 0008](decisions/0008-browser-e2e-via-cdp.md))

Follow-ups (done 2026-10-06, session 16):
- [x] Collapse/expand containers in the layer tree (toggle, ←/→, collapse/expand all, reveal on selection, opens while hovering during a drag)
- [x] Auto-scroll while dragging in long trees
- [x] Copy/cut/paste of nodes, also between pages (Ctrl/⌘+C/X/V; clipboard text validated, fresh ids)
- [x] Per-node labels ("Hero – Pricing") in the layer tree and on the canvas chip (editor-only, never rendered)

## Site integration (admin bar, view, preview) ✅ (2026-10-04 – 2026-10-06; two items dropped)

Drupal-style movement between the site and the dashboard. Works for every StudioCMS page type.
Guide: [admin-bar.md](admin-bar.md). Decision: [ADR 0009](decisions/0009-server-rendered-admin-bar.md).

- [x] `getPage()`: draft-safe page loading (fixes the draft leak, known issue #10), cache and robots headers
- [x] `getViewer()`: StudioCMS session check on public routes, fail closed
- [x] `<AdminBar>`: server-rendered, zero JS, nothing for anonymous visitors; Edit page, Add page, Dashboard, status, Log out
- [x] "View page ↗" in the Tapestry editor (`pageUrlPattern` option)
- [x] StudioCMS corner menu disabled correctly (`features.injectQuickActionsMenu`); public JS 18.7 KB → 174 B
- [x] e2e site suite (10 steps): anonymous, forged cookie, editor drafts, headers, bar position, Edit ⇄ View round trip, Log out
- ~~"View page" on StudioCMS's edit screen for all page types~~: not planned (user decision, 2026-10-06). StudioCMS's edit screen has no extension point (augments only affect rendered content); it would need a StudioCMS patch. Tapestry pages have "View page" in the editor, and the admin bar links back from the site.
- [x] **Preview** of saved drafts on the real URL (`?tapestry-preview`, editors only; admin bar link). Done with publishing, below.
- ~~Shareable preview links for people without an account~~: not planned (user decision, 2026-10-06)
- [ ] Report upstream: `bySlug` drafts (known issue #10), `features` key (known issue #5)

## Phase 3: Visual canvas ✅ (2026-10-05)

Goal: WYSIWYG, like Drupal Canvas. Decision: [ADR 0010](decisions/0010-visual-canvas.md).

- [x] Canvas mode (editors only) with invisible node markers; `tapestry-root` wrapper
- [x] Editors-only render endpoint (`/_tapestry/render`): same pipeline, same-origin, size-limited
- [x] Iframe canvas showing the real page (site layout + CSS); live swap on edit (debounced, stale requests aborted)
- [x] Click to select, hover outlines, selection chip (drag handle, duplicate, delete), navigation blocked
- [x] Drag from the library or layers onto the canvas; drag components directly on the page (or by the chip) to move them; geometry module with unit tests
- [x] Selection sync both ways (tree ⇄ canvas, scroll into view)
- [x] Viewport switcher (Desktop / Tablet / Mobile), full-screen mode with Save and Ctrl/⌘+S
- [x] e2e canvas suite (17 steps, real mouse drags), including visual parity with the public page and endpoint security

Next for the canvas:
- [x] Inline text editing directly on the canvas for rich text (ADR 0013) and plain text props (ADR 0024)
- [x] Per-node partial re-render: a settings change re-renders just that component (2026-10-07)
- [x] Run component client scripts after a live swap: new scripts run once per canvas page (islands hydrate) ([ADR 0030](decisions/0030-islands.md), 2026-10-07)
- [x] Empty containers: visible drop zone inside the canvas (canvas mode only; 2026-10-06)
- [x] Keyboard-accessible canvas navigation: arrows select, Alt+arrows move, Enter edits text, Delete, duplicate, copy/cut/paste (shared with the layer tree; 2026-10-06)

## Publishing: drafts, publish, history ✅ (2026-10-05)

Tapestry pages only. Decision: [ADR 0011](decisions/0011-draft-publish-history.md).

- [x] Stored page format 2 (published, draft, history); format-1 pages read as published
- [x] Save keeps changes as a draft; visitors keep seeing the published version
- [x] **Publish** button; status pill (Not published yet / Published / Unpublished changes)
- [x] History of the 5 previous published versions (`historyLimit` option), **Restore to draft**
- [x] **Discard unpublished changes**
- [x] Editors preview the draft on the real URL; never-published pages are a 404 for visitors
- [x] Admin bar shows the publishing status with Preview draft / View published
- [x] StudioCMS's anonymous REST API redacted to published content (middleware; known issue #22)
- [x] 9 unit tests for redaction, 13 for revisions; e2e publishing suite (11 steps)

Possible follow-ups:
- [x] Scheduled publishing (publish at a date/time; applied by every reader once due, no background job; 2026-10-07)
- [x] Side-by-side comparison of a history entry with the live version or the draft: change list + both versions on the real page (2026-10-07)
- [x] "Publish" permission separate from "edit" (`publishPermission`; enforced on the server; ADR 0022, 2026-10-07)

## Media library ✅ (2026-10-06, `@nascencestudio/medialibrary`)

Decision: [ADR 0016](decisions/0016-media-library.md). Moved to its own repository,
[nascencestudio/medialibrary](https://github.com/nascencestudio/medialibrary), on 2026-10-08
([ADR 0037](decisions/0037-media-library-repository.md)); its roadmap continues there.

- [x] Uploads checked by content (images incl. AVIF and sanitized SVG, video, audio, documents), per-kind limits
- [x] Remote videos (YouTube, Vimeo) by link, privacy-friendly embeds
- [x] Dashboard Media page: grid, filters, search, drag-and-drop upload with progress, alt text, usage, delete with warning
- [x] Picker dialog for other plugins; Tapestry `media` props and rich text "Insert media"
- [x] Local-disk storage, public serving with ranges and a sandbox CSP
- [x] Admin settings (Plugins → Media Library → Uploads): size limits per kind within a developer ceiling, SVG on/off ([ADR 0018](decisions/0018-media-upload-settings.md))
- [x] Replace file (keeps id, alt, tags, focal point, captions; new URL) ([ADR 0019](decisions/0019-media-editing-extras.md))
- [x] Tags with a library filter (instead of folders)
- [x] Captions/subtitles for uploaded videos (WebVTT; SRT converted; files rebuilt)
- [x] Focal point for images (click or arrow keys; crop previews; `object-position`)
- [x] Responsive images: resized WebP copies + `srcset` (sharp), admin backfill for older images
- [ ] Later / on request: S3 storage (the user has no use for it now), AVIF copies, video
  posters/duration, document page counts, captions for audio

## Deployment ✅ (2026-10-06)

- [x] Docker (non-root, read-only FS) + Caddy HTTPS for a Hetzner Cloud server ([ADR 0017](decisions/0017-docker-deployment.md), [guide](guides/deployment.md))
- [x] CI: checks, e2e on a fresh site, production image with a sharp check ([ADR 0020](decisions/0020-continuous-integration.md)); runs once the repo is on GitHub
- [x] Dependabot for pinned action SHAs and dependencies (`.github/dependabot.yml`: weekly, 3-day cooldown like `minimumReleaseAge`, minor/patch grouped; active once on GitHub)

## Phase 4: Rich content ✅ (2026-10-05 – 2026-10-07)

- [x] Image prop: the `media` prop type with the media library (alt text kept on the media item)
- [x] Rich text prop (`richtext`) with a per-field toolbar allowlist, ProseMirror editor, JSON storage, `RichText.astro` ([ADR 0012](decisions/0012-rich-text.md), 2026-10-05)
- [x] Rich text follow-ups (2026-10-06): inline editing on the canvas ([ADR 0013](decisions/0013-inline-canvas-editing.md)); admin-configurable toolbars ([ADR 0014](decisions/0014-admin-toolbar-settings.md)); "remove formatting" button
- [x] Inline editing for plain `text` props on the canvas: the element is found automatically, with an optional `data-tapestry-text-prop` marker (ADR 0024, 2026-10-07). (The "floating toolbar" part was done with ADR 0013: the toolbar sits under the chip.)
- [x] Link prop: a page on this site (by id, follows renames; drafts hidden from visitors) or a web address, plus new tab ([ADR 0025](decisions/0025-link-prop.md), 2026-10-07)
- [x] List/repeater and object props: items with the same fields, one level of nesting, add/remove/reorder with undo ([ADR 0026](decisions/0026-list-and-object-props.md), 2026-10-07)
- [x] Named slots (e.g. a two-column layout with `left` and `right`): `slots` on the definition, `slot` on children; canvas, tree and keyboard support ([ADR 0027](decisions/0027-named-slots.md), 2026-10-07)
- [x] Reusable patterns / saved sections: saved copies, inserted from the library (click or drag); author/admin delete ([ADR 0028](decisions/0028-patterns.md), 2026-10-07). Linked (shared) patterns: later.
- [x] Component thumbnails/previews in the library: live previews on hover/focus (sandboxed, site CSS) and optional `thumbnail` images ([ADR 0029](decisions/0029-library-previews.md), 2026-10-07)

## Phase 5: Production readiness

- [x] Interactive components: framework components with `client: 'load' | 'idle' | 'visible'` (generated island wrappers; StudioCMS patch keeps component scripts; canvas runs new scripts) ([ADR 0030](decisions/0030-islands.md), 2026-10-07)
- [x] Document migrations framework: component versions with prop migrations (lazy, on read), `replaces` for renamed components, format migrations (next format is 3) ([ADR 0031](decisions/0031-migrations.md), 2026-10-07)
- [x] i18n: one page per language in translation groups (`languages` option, translations menu, `getPage()` language + translations, links follow the language) ([ADR 0032](decisions/0032-translations.md), 2026-10-07). StudioCMS's content-language rows were not usable (no dashboard support).
- [x] Permissions (who can use which components): `permission` on definitions; locked for lower roles in the editor; enforced on save ([ADR 0033](decisions/0033-component-permissions.md), 2026-10-08)
- [x] Visual diff between versions: see "Compare" in Publishing (2026-10-07)
- [x] Accessibility audit of the editor (axe-core in e2e, both themes; fixes for outline, contrast, reduced motion); performance budget for public pages (`pnpm budget`, in CI) ([ADR 0034](decisions/0034-accessibility-and-performance.md), 2026-10-08)
- [ ] Publish `@nascencestudio/tapestry` to npm with provenance: **prepared** (0.1.0, READMEs, LICENSE, release workflow with provenance/trusted publishing, StudioCMS patch shipped; [ADR 0035](decisions/0035-npm-release.md)); repositories set (nascencestudio/tapestry, nascencestudio/medialibrary, [ADR 0037](decisions/0037-media-library-repository.md)); media library 0.1.0 published 2026-10-09 and used from npm; Tapestry's release next
- [x] Documentation site: Starlight in `website/`, generated from `docs/`, deployed to GitHub Pages ([ADR 0036](decisions/0036-documentation-site.md), 2026-10-08)

## Later / maybe

- Real-time collaboration (Canvas has it; it's significant work)
- AI-assisted page building
- In-browser "code components" (Canvas has these; weigh carefully, since
  running editor-authored code is a large security surface)
