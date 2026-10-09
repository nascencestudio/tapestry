# Upstream report: rendered page content loses every `<script>` (known issue #37)

Ready to file at <https://github.com/withstudiocms/studiocms/issues> (the user approved
reporting this one, 2026-10-08). Tapestry ships a workaround patch until it's fixed.

---

**Title:** Page rendering strips `<script>` from component output (Astro islands never hydrate)

**Version:** studiocms 0.6.1, @withstudiocms/component-registry 0.2.1, Astro 7.3.5

**What happens**

Components rendered through the component registry (or a page type's renderer) can't
ship client JavaScript: every `<script>` they emit is removed from the page. Astro islands
(`client:load`, `client:visible`, …) render their HTML but never hydrate, because Astro's
island bootstrap is an inline `<script>` emitted before the first island; and `<script>`
tags in `.astro` components (which Astro 7 renders inline where the component is used) are
dropped too. Astro's `<style>astro-island,…{display:contents}</style>`, emitted together
with those scripts, survives, which shows the output was produced and then filtered.

**Why**

`dist/virtuals/components/renderFn.js` renders the content (`createRenderer`, which
sanitizes the renderer's HTML with the page type's `sanitizeOpts` *before* swapping in
components), then runs two more passes over the **rendered output**:

```js
renderedContent = await transformHTML(renderedContent, components);
renderedContent = await transformHTML(renderedContent, {}, {}, [transformStorageAPI({ site })]);
```

`transformHTML()` always adds ultrahtml's `sanitize()`, and with default options that drops
`script` elements. These passes exist for augment components and storage URLs, but they
also re-sanitize everything components produced.

**Reproduce**

1. A page type whose renderer outputs a registry component, e.g. `<my-counter></my-counter>`.
2. `my-counter` is an `.astro` file rendering `<Counter client:load />` (any framework) or
   containing `<script>console.log('hi')</script>`.
3. View the page: no `<script>` in the HTML; the island has `ssr` but never hydrates.

**Suggestion**

Don't re-sanitize component output in the post-render passes (the input was already
sanitized before the swap), or let page types opt out. Tapestry's workaround patch adds a
renderer flag (`componentScripts: true`) that skips the sanitizer in those two passes and
leaves other page types unchanged: see `packages/tapestry/patches/studiocms@0.6.1.patch`.
