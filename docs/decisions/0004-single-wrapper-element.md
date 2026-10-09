# 0004. Render every node through one `<tapestry-node>` wrapper

- Status: Accepted
- Date: 2026-10-02

## Context

StudioCMS renderers return HTML strings. StudioCMS then runs the HTML through
ultrahtml: first `sanitize`, then `swap`, which replaces registered custom
elements with Astro components, passing attributes as props and inner HTML
as the default slot.

The first implementation mapped each Tapestry component to its own custom
element (`<tapestry-hero heading="…">`) and registered every component in
`componentRegistry`. Testing against the real ultrahtml pipeline showed:

1. **Attribute values aren't entity-decoded.** `heading="Say &quot;hi&quot;"`
   reaches the component as the literal string `Say &quot;hi&quot;`, and Astro
   escapes it again, so visitors would see `&quot;` on the page.
2. **All props become strings.** Numbers and booleans would need parsing in every component.
3. Users would need to list every component in `componentRegistry`, duplicating the Tapestry config.

## Decision

Register a single wrapper element, `tapestry-node`, mapped to Tapestry's own
`Node.astro`. Each node renders as:

```html
<tapestry-node type="hero" props="%7B%22heading%22%3A%22Say%20%5C%22hi%5C%22%22%7D">…children…</tapestry-node>
```

- `props` is `encodeURIComponent(JSON.stringify(props))`. The output contains
  no `"`, `&`, `<` or `>`, so it needs no HTML escaping, and it survives the
  pipeline byte-for-byte.
- `Node.astro` decodes the props, looks up the real component in the
  `virtual:tapestry/components` module (static imports generated at build
  time), and renders it with children in the default slot.

## Alternatives considered

- **Per-component elements + entity decoding in each component**: pushes a
  footgun onto every component author.
- **Base64 props**: equivalent safety, but opaque when debugging; URL encoding
  stays human-readable.
- **Bypass the registry by rendering with Astro's Container API inside the
  renderer**: the renderer has no access to the request's `SSRResult`; it would
  render out of context (no shared head/CSS propagation) and is experimental.
- **Augment plugins** (`ComponentRenderAugment`): enabled per page via
  `data.augments`, so not suitable for always-on rendering.

## Consequences

- Props keep JSON types (number, boolean, string).
- Users add exactly one registry entry: `...tapestryComponentRegistry()`.
- The sanitizer allowlist is a single element, which is easy to reason about.
- Each node costs one extra component call on the server (negligible).
- The live-preview phase can add `data-tapestry-id` in one place (`Node.astro`).
