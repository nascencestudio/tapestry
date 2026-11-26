# Architecture decision records

Each ADR captures one significant decision: the context, what we chose, the
alternatives, and the consequences. ADRs are never deleted. If a decision
changes, write a new ADR that supersedes the old one and update the old one's status.

| # | Decision | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-build-as-a-studiocms-page-type-plugin.md) | Build Tapestry as a StudioCMS page-type plugin | Accepted | 2026-10-02 |
| [0002](0002-preact-for-editor-ui.md) | Use Preact (not React) for the editor UI | Accepted | 2026-10-02 |
| [0003](0003-pnpm-and-supply-chain-hardening.md) | pnpm with strict supply-chain policies | Accepted | 2026-10-02 |
| [0004](0004-single-wrapper-element.md) | Render every node through one `<tapestry-node>` wrapper | Accepted | 2026-10-02 |
| [0005](0005-json-tree-document-format.md) | Store pages as a validated JSON tree | Accepted | 2026-10-02 |
| [0006](0006-build-our-own-editor-not-puck.md) | Build our own Preact editor instead of using Puck | Accepted | 2026-10-02 |
| [0007](0007-drag-and-drop-library.md) | Pragmatic drag and drop for the editor | Accepted | 2026-10-02 |
| [0008](0008-browser-e2e-via-cdp.md) | Browser e2e tests with a dependency-free CDP harness | Accepted | 2026-10-02 |
| [0009](0009-server-rendered-admin-bar.md) | Server-rendered admin bar and a draft-safe page loader | Accepted | 2026-10-04 |
| [0010](0010-visual-canvas.md) | Visual canvas: the real page in an iframe, updated live | Accepted | 2026-10-05 |
| [0011](0011-draft-publish-history.md) | Drafts, publishing and version history inside the stored content | Accepted | 2026-10-05 |
| [0012](0012-rich-text.md) | Rich text: a `richtext` prop type, stored as JSON, edited with ProseMirror | Accepted | 2026-10-05 |
| [0013](0013-inline-canvas-editing.md) | Inline editing of rich text on the canvas | Accepted | 2026-10-06 |
| [0014](0014-admin-toolbar-settings.md) | Admins narrow rich text toolbars from the dashboard | Accepted | 2026-10-06 |
| [0015](0015-nascence-studio-namespace.md) | Packages under the @nascencestudio scope | Accepted | 2026-10-06 |
| [0016](0016-media-library.md) | A media library plugin (@nascencestudio/medialibrary) | Accepted | 2026-10-06 |
| [0017](0017-docker-deployment.md) | Docker deployment on a single Hetzner Cloud server | Accepted | 2026-10-06 |
| [0018](0018-media-upload-settings.md) | Admins set media upload limits and the SVG switch | Accepted | 2026-10-06 |
| [0019](0019-media-editing-extras.md) | Media editing extras: replace file, tags, captions, focal point, resized images | Accepted | 2026-10-06 |
| [0020](0020-continuous-integration.md) | Continuous integration with GitHub Actions | Accepted | 2026-10-06 |
| [0021](0021-keep-dashboard-css-off-public-pages.md) | Keep dashboard CSS off public pages (three dependency patches) | Accepted | 2026-10-06 |
| [0022](0022-publish-permission.md) | A publish permission separate from edit | Accepted | 2026-10-07 |
| [0023](0023-scheduled-publishing-and-version-comparison.md) | Scheduled publishing and version comparison | Accepted | 2026-10-07 |
| [0024](0024-inline-editing-plain-text.md) | Inline editing of plain text props on the canvas | Accepted | 2026-10-07 |
| [0025](0025-link-prop.md) | Link prop: a page on this site or a web address | Accepted | 2026-10-07 |
| [0026](0026-list-and-object-props.md) | List (repeater) and object props | Accepted | 2026-10-07 |
| [0027](0027-named-slots.md) | Named slots | Accepted | 2026-10-07 |
| [0028](0028-patterns.md) | Patterns (saved sections) | Accepted | 2026-10-07 |
| [0029](0029-library-previews.md) | Component thumbnails and live previews in the library | Accepted | 2026-10-07 |
| [0030](0030-islands.md) | Interactive components (Astro islands) | Accepted | 2026-10-07 |
| [0031](0031-migrations.md) | Document and component migrations | Accepted | 2026-10-07 |
| [0032](0032-translations.md) | Translations: one page per language, linked in a group | Accepted | 2026-10-07 |
| [0033](0033-component-permissions.md) | Component permissions | Accepted | 2026-10-08 |
| [0034](0034-accessibility-and-performance.md) | Accessibility audit and performance budget | Accepted | 2026-10-08 |
| [0035](0035-npm-release.md) | Releasing to npm with provenance | Accepted | 2026-10-08 |
| [0036](0036-documentation-site.md) | Documentation site (Starlight on GitHub Pages) | Accepted | 2026-10-08 |
| [0037](0037-media-library-repository.md) | The media library moves to its own repository | Accepted | 2026-10-08 |
| [0038](0038-plugin-only-repository.md) | The Tapestry repository holds only the plugin | Accepted | 2026-10-09 |
| [0039](0039-public-pages-and-tapestry-seo.md) | Listing public pages; the tapestry-seo plugin | Accepted | 2026-10-11 |
| [0040](0040-seo-button.md) | The SEO button: Tapestry's hook for tapestry-seo | Accepted | 2026-10-12 |
| [0041](0041-templates.md) | Templates: shared headers, footers and page layouts | Accepted | 2026-10-15 |
| [0042](0042-companion-hooks.md) | Hooks for companion plugins: server choices, link resolution, editor buttons | Accepted | 2026-10-16 |
| [0043](0043-studiocms-0.7.md) | StudioCMS 0.7.0: supported alongside 0.6, after the release-age gate | Accepted | 2026-10-19 |
| [0044](0044-shared-preact-runtime.md) | One Preact runtime: ranges for preact and @preact/signals | Accepted | 2026-10-22 |
| [0045](0045-shipped-studiocms-fixes.md) | Shipped patches cover StudioCMS bugs sites hit, including the SDK | Accepted | 2026-10-22 |
| [0046](0046-display-modes.md) | Display modes: templates that show a page in more than one way | Accepted | 2026-10-23 |
| [0047](0047-prosemirror-ranges.md) | One ProseMirror: ranges for the prosemirror-* packages | Accepted | 2026-11-25 |
| [0048](0048-preact-11.md) | Preact 11 alongside Preact 10 | Accepted | 2026-11-26 |

## Template

```md
# NNNN. Title

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD

## Context
What problem, what constraints, what we learned.

## Decision
What we chose.

## Alternatives considered
What else, and why not.

## Consequences
What gets easier, what gets harder, follow-ups.
```
