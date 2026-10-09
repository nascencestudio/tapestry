# 0009. Server-rendered admin bar and a draft-safe page loader

- Status: Accepted
- Date: 2026-10-04

## Context

Editors need to move easily between the public site and the dashboard, as with
Drupal's toolbar. StudioCMS 0.6 offers only a client-side "Quick Tools" corner
menu (an avatar in the bottom-right corner, shown after the first mouse movement). Its
"Edit" link goes to the content list rather than the current page, and its ~18 KB
script ships to every visitor, logged in or not. There are no third-party
StudioCMS plugins for this (the ecosystem is 8 official packages).

While investigating, we found that `SDKCoreJs.GET.page.bySlug()` **does not filter
drafts**, and the official `@studiocms/blog` route (which our playground route
copied) serves drafts to anyone who knows the URL.

## Decision

1. **`getPage(Astro)`** (`@nascencestudio/tapestry/page`) loads a page by slug and
   enforces visibility: drafts return `null` (→ 404) unless the viewer is an
   editor. It sets `Cache-Control: private, no-store` for editors and
   `X-Robots-Tag: noindex` for drafts. The access rules are a pure function
   (`pageAccess()`) with unit tests.
2. **`getViewer(Astro)`** resolves the session with StudioCMS's own
   `User.getUserData()`, because StudioCMS only populates session locals for
   dashboard and API routes. It fails closed.
3. **`<AdminBar>`** (`@nascencestudio/tapestry/AdminBar.astro`) is server-rendered,
   zero-JS, and emitted (markup **and** inline CSS) only for editors.
4. The playground disables StudioCMS's corner menu (`features.injectQuickActionsMenu: false`).

## Alternatives considered

- **Client-side bar (like StudioCMS's Quick Tools).** Works with fully static
  caching, but ships JavaScript to every visitor and fires a session request
  from every browser. Rejected: conflicts with our zero-JS goal.
- **Middleware that injects the bar into every HTML response.** No layout change
  needed, but rewriting response bodies is fragile (streaming, non-HTML responses)
  and still needs page identity for "Edit page". Might be offered later as an
  opt-in convenience.
- **Patch StudioCMS's Quick Tools.** It's injected from StudioCMS's own source; there's no
  extension point for menu items.

## Consequences

- Site owners make two small changes (use `getPage`, add `<AdminBar>`), both documented
  in [admin-bar.md](../admin-bar.md).
- Responses rendered for editors can't be shared-cached (correct, since they contain
  admin UI and possibly drafts). Anonymous responses are unchanged.
- Requests that carry a session cookie cost one session lookup.
- The inline `<style>` needs CSP allowance for editors; a nonce option can follow.
- Style isolation: `all: initial` plus selectors anchored on `#tapestry-adminbar`.
  (Class-based selectors lost to a site rule like `.site a`, which turned the bar's
  links purple. Found 2026-10-05 and covered by an e2e color check.)
- The same `getPage()` is the hook for the upcoming **preview** feature: a preview
  token will make it serve unsaved draft content to the editor who requested it.
