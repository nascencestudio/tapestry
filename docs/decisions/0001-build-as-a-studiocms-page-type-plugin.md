# 0001. Build Tapestry as a StudioCMS page-type plugin

- Status: Accepted
- Date: 2026-10-02

## Context

We want Drupal Canvas-style visual page building on Astro + StudioCMS.
StudioCMS (0.6) provides auth, a dashboard, page storage (libSQL, Postgres,
MySQL), revisions/diffs, and a plugin API. Its plugin API lets a plugin
register **page types**, each with:

- a `rendererComponent`: a module exporting `{ name, renderer(content) => html, sanitizeOpts }`
- a `pageContentComponent`: an Astro component rendered inside the dashboard's
  page edit form, which saves `<textarea name="page-content">`.

StudioCMS also has a **component registry** that replaces registered custom
elements in rendered HTML with Astro components on the server.

## Decision

Tapestry is a StudioCMS plugin that registers one page type, `tapestry/canvas`.
The page content is a JSON component tree. Our renderer turns it into HTML that
the component registry expands into real Astro components. Our editor component
is the Tapestry editor.

## Alternatives considered

- **Standalone Astro integration with its own storage and admin UI.** Full
  control, but we'd rebuild auth, storage, revisions, and a dashboard: months
  of work that StudioCMS already does.
- **A different CMS backend (Payload, Keystatic, Decap) plus a custom Astro renderer.**
  Workable, but the user specifically chose StudioCMS, which is Astro-native.
- **Fork StudioCMS.** Maintenance burden; plugins are the supported extension point.

## Consequences

- We inherit StudioCMS's storage, auth, permissions, drafts, and diffs for free.
- We're bound by StudioCMS's contracts: content is a string; the renderer returns
  HTML; the editor communicates through a form field. ADR 0004 covers how we
  render real components within that.
- StudioCMS is pre-1.0 and its docs lag its code. We pin versions, check
  behavior against source, and record findings in
  [research/studiocms-internals.md](https://github.com/nascencestudio/tapestry-playground/blob/main/docs/research/studiocms-internals.md).
- Users must add one `componentRegistry` line, because plugins can't register
  components themselves.
