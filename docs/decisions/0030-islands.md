# 0030. Interactive components (Astro islands)

- Status: Accepted (the user chose the full option: framework islands, with the
  Preact integration in the playground)
- Date: 2026-10-07

## Context

Phase 5 starts with "interactive components: per-component hydration
(`client:visible` etc.) for Preact components", and the canvas item "re-run
component client scripts after a live swap" depends on it. Rule 2 still holds:
public pages ship zero JS unless a component opts in.

Three facts shaped the design:

1. Astro hydrates only components that are **statically imported** in an
   `.astro` file with a **literal** `client:*` directive (the compiler records
   the component's path). `Node.astro` picks components at render time, so it
   can't put a directive on them.
2. StudioCMS's renderer **strips every `<script>`** that components render: after
   the component swap it runs two more `transformHTML()` passes over the rendered
   output, each with ultrahtml's default sanitizer (known issue #37). Astro's
   island bootstrap (and any component `<script>`) never reached the page; islands
   would render but never hydrate.
3. The canvas swaps in markup from the render endpoint, and inserted `<script>`
   elements don't run.

## Decision

1. **Definitions:** `component` may be a framework component (`.tsx`, `.jsx`,
   `.svelte`, `.vue`; the site brings the framework's Astro integration).
   `client: 'load' | 'idle' | 'visible'` makes it an island; without it, it
   renders to HTML only (no JS). `client` on an `.astro` component is an error
   (they can use islands inside themselves).
2. **Generated wrappers:** for each component with `client`, the plugin writes
   `node_modules/.tapestry/islands/<type>.astro` at startup (only when the
   content changes): a static import plus `<Component client:visible {...Astro.props} />`,
   passing the default slot and named slots through. `virtual:tapestry/components`
   imports the wrapper instead of the component. Props reach the island as
   serialized data (Astro's `props` attribute); media and links are resolved first.
3. **StudioCMS patch** (added to the existing `studiocms@0.6.1` patch): a page-type
   renderer that sets `componentScripts: true` gets the two post-render passes
   **without** the sanitizer (same component swap and storage-URL transform).
   Tapestry's renderer sets it. This is safe for Tapestry because its content is
   validated JSON that can't contain HTML: text and attributes are escaped by Astro,
   URLs are checked, and the first pass still sanitizes the renderer's own output
   before components are swapped in. So every script in the result comes from a
   developer's component. Other page types (Markdown) are unchanged. An e2e step
   puts `<script>`, an `onerror` image and a `javascript:` link into text, a button
   and an island's props, and checks they stay inert.
4. **Canvas:** each live render's scripts that the canvas page hasn't run yet run
   once (`canvas/scripts.ts`): Astro's island bootstrap, so new `<astro-island>`
   elements hydrate by themselves, and component scripts by URL. Nothing runs
   twice, so component scripts should act on elements as they appear (custom
   elements, as Astro recommends). Clicks on the canvas still select instead of
   interacting, and plain-text editing skips text inside islands (the framework
   owns that DOM).

## Dependency review: `@astrojs/preact` (playground only)

The plugin itself gains **no** dependency; sites bring their own integration. The
playground needs one to exercise islands.

| Package | Version | Provenance | Notes |
| --- | --- | --- | --- |
| `@astrojs/preact` | **6.0.5** (2026-08-31) | ✓ SLSA v1 | 23 KB unpacked, MIT. 6.0.6 (2026-10-06) is inside the 3-day `minimumReleaseAge` window; Dependabot will offer it after the cooldown. |
| `@preact/preset-vite` | 2.10.6 | ✓ | Brings Babel (`@babel/core` + JSX transforms), Prefresh (dev refresh) and `vite-prerender-plugin`. |
| `preact-render-to-string` | 6.8.0 | ✓ | Server rendering. |
| `preact` | 10.29.8 | (already pinned) | Direct dependency of the playground (peer of the integration). |

- The install added 67 lockfile entries (about 45 distinct packages, mostly Babel
  helpers, `browserslist`/`caniuse-lite`, Prefresh). All are build-time tools: none
  are imported by public pages.
- `pnpm audit`: no new advisories. The supply-chain policies (`trustPolicy:
  no-downgrade`, `blockExoticSubdeps`, `strictDepBuilds`, release age) passed;
  no package needed a build script.
- What visitors load, measured on a production build: pages **without** an
  island are unchanged (no island code; only the existing 174-byte transition
  polyfill from `@studiocms/ui`). A page with the Counter loads the component, Preact
  and its hooks, and Astro's Preact client: **≈ 7.9 KB gzipped**, plus Astro's
  inline island bootstrap.

## Alternatives considered

- **Islands without the StudioCMS patch:** a site-layout component that renders
  dummy islands so Astro emits its bootstrap outside the sanitized content. It needs
  a framework component in Tapestry itself, one dummy per directive, and still loses
  ordinary component `<script>`s. The patch fixes the root cause for both.
- **Patching the sanitizer to allow `<script>` for every page type:** removes defense
  in depth for page types whose content is HTML (Markdown).
- **Virtual `.astro` wrapper modules** instead of files: Astro's compiler needs a real
  path to record the component for hydration; files are robust.
- **Option 2 (dependency-free part only):** the user preferred full support.

## Consequences

- A fourth change in the StudioCMS patch, with a reason and an exit condition in
  `pnpm-workspace.yaml`. If StudioCMS stops re-sanitizing rendered output, the
  `componentScripts` flag becomes unnecessary.
- Astro component `<script>`s inside Tapestry components now work on public pages
  too (they were silently dropped before).
- Island props are visible in the page source (as with any Astro island).
- e2e suite `islands` (5 steps); unit tests for wrappers and the canvas script runner.
