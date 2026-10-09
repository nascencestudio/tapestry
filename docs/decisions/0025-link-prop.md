# 0025. Link prop: a page on this site or a web address

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 4 lists "Link prop: internal page picker or external URL". The `url` prop
stores a string, so a link to a page on the site is a copied path that breaks
when the page's slug changes, and editors have to know the path. Components also
each reimplement "open in a new tab" (and must remember `rel="noopener"`).

## Decision

1. **New prop type `link`.** Stored value (`LinkValue`):
   - `{ type: 'page', page: '<StudioCMS page id>', newTab?: true }`, or
   - `{ type: 'url', url: '<url rules>', newTab?: true }`.
   Canonical key order `type, page|url, newTab`; `newTab` only when true.
   `cleanLinkValue()` (pure, adversarial tests) enforces it: page ids are
   1–64 characters of `[A-Za-z0-9_-]`, web addresses follow the `url` rules.
   A **string** is read as `{ type: 'url', url }`, so changing a prop from `url`
   to `link` keeps existing content working. Defaults may be either form.
2. **Components get a `ResolvedLink | null`**, never the stored value:
   `{ href, external, newTab, rel, title }`. `Node.astro` resolves page links by
   id at render time (current slug through `pagePath()`, so renames are
   followed), deduplicating lookups; `rel` is `noopener noreferrer` for new-tab
   links; `external` is true for other hosts, `mailto:` and `tel:`.
   - A deleted page gives `null` (the component renders no `href`).
   - A **draft** page gives `null` for visitors (its path and title are
     unpublished information); editors (canvas, preview) get the link. The
     session check runs only when a linked page is a draft, once per request.
3. **Editor field:** "Page on this site" (a list of pages, with a filter above 8
   pages, drafts marked) or "Web address" (text input; `type="url"` would reject
   relative paths), plus "Open in a new tab". The list comes from
   `GET /_tapestry/pages` (editors only, `no-store`, read-only: id, title,
   path, draft flag).

## Alternatives considered

- **Store the path for page links** (and update it on rename): needs a hook on
  StudioCMS's page save and a rewrite of every document; ids never change.
- **Resolve links in the editor** and store the href: renames would break links.
- **Extend `url` instead of a new type:** components would receive either a
  string or an object depending on content; a separate type keeps `url` simple.

## Consequences

- One indexed page lookup per distinct linked page per render (StudioCMS caches
  page metadata).
- The playground's Button uses `link`; its separate `newTab` prop is gone. The
  Hero keeps a `url` prop, so both are exercised.
- e2e suite `links` (10 steps).
