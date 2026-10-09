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
