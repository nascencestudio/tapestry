# 0036. Documentation site (Starlight on GitHub Pages)

- Status: Accepted (the user chose Starlight on GitHub Pages, 2026-10-08)
- Date: 2026-10-08

## Context

The last Phase 5 item. The docs live as Markdown in `docs/` (guides, reference, ADRs) and
in the package READMEs; they're readable on GitHub but not searchable or navigable as a
site. They must stay the single source of truth: no second copy to drift.

## Decision

1. **`website/`**, a workspace package (private): an Astro site with **Starlight**
   (sidebar, search via Pagefind, dark/light, accessible defaults).
2. **Generated pages:** `website/scripts/sync-docs.mjs` (run by `dev` and `build`) copies the
   published sources into `src/content/docs/` (gitignored): the Tapestry README ("Install
   and set up"), the guides, data model, architecture, security, known issues, roadmap and
   every ADR. The first `# Heading` becomes the title; links between published pages become
   site URLs (with the base path); links to other repository files point to GitHub
   (`REPO_URL`) or become plain text. The landing page (`index.mdx`) is the site's own.
   Not published: the devlog, research notes, upstream drafts, CLAUDE.md.
3. **Deploy:** `.github/workflows/docs.yml` builds on pushes to `main` that touch the docs and
   deploys with GitHub's Pages actions (SHA-pinned); `configure-pages` provides the origin
   and base path, so the same build works for `<owner>.github.io/<repo>/` or a custom domain.
4. **Check:** a build with a `/tapestry` base had 2,553 internal links, none broken.

## Dependency review: `@astrojs/starlight` (website only)

| Package | Version | Provenance | Notes |
| --- | --- | --- | --- |
| `@astrojs/starlight` | **0.42.5** (2026-10-01) | ✓ SLSA v1 | MIT, 1.2 MB unpacked. Peer `astro ^7.2.10` (we use 7.3.5). |

- 113 new lockfile entries: Expressive Code (code blocks), Pagefind (search index, built at
  build time; its platform binary comes as an optional dependency, no install script),
  unified/remark/rehype utilities, i18next. All build-time; the published site is static
  HTML/CSS plus Starlight's small client scripts (search, theme, sidebar).
- `pnpm audit` flagged GHSA-rj75-hqrm-r3gf (moderate, CPU exhaustion in
  `postcss-selector-parser` < 7.1.6, via Expressive Code's `postcss-nested` 6, which has no
  fixed 6.x). Fixed with a scoped override `@expressive-code/core>postcss-nested: 8.0.1`
  (which uses the 7.x parser); the site builds and code blocks render. Exit condition in
  `pnpm-workspace.yaml`.
- No build scripts needed (`strictDepBuilds` passed).

## Alternatives considered

- **A plain Astro site** (the user's second option): fewer dependencies, but search,
  navigation and accessibility work would be ours to build and maintain.
- **Moving the Markdown into the site:** GitHub readers (and agents working in the repo)
  use `docs/`; generating keeps one source.
- **Starlight's content loader pointed at `../docs`:** pages need frontmatter titles and
  links need rewriting either way; a small sync script is explicit and testable.

## Consequences

- Editing `docs/` is all it takes; the site updates on the next push to `main`.
- GitHub Pages must be enabled once (Settings → Pages → Source: GitHub Actions).
