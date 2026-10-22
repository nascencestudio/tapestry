# 0043. StudioCMS 0.7.0: supported alongside 0.6, after the release-age gate

- Status: Accepted (the user's decisions, 2026-10-19); install and full test run on or after
  2026-10-22 19:47 UTC (the release-age gate)
- Date: 2026-10-19

## Context

StudioCMS 0.7.0 came out on 2026-10-19 (19:44 UTC), with `@studiocms/md` 0.5.1 and new versions of four
`@withstudiocms/*` packages (internal_helpers 0.5.0, component-registry 0.2.2, effect 0.5.3, auth-kit
0.2.2), all published within two minutes. Our plugins declare `studiocms: ^0.6.0`, which for 0.x
excludes 0.7. The playground and Tapestry carry StudioCMS patches (known issues #12, #32, #37, #38).

## Review (before installing: the tarballs, integrity-checked, compared with 0.6.1)

- **Changes:** dashboard and SDK markdown parsing moves from micromark to Satteri (the version modal's
  changelog and an SDK changelog endpoint), a Windows path fix in the translations loader, and a
  **security fix**: the dashboard search API (`searchList`) listed every page and folder, drafts
  included, without checking the user; it now requires a logged-in editor. Eight files differ in all;
  none of them is a file our patches change or our code depends on (page forms, dashboard layout,
  plugin handler, renderer).
- **Patches:** Tapestry's StudioCMS patch and the playground's apply to 0.7.0 unchanged (no fuzz): the
  bugs they fix are still there. `@studiocms/md` 0.5.1 is 0.5.0's code with a new `package.json`; its
  patch applies too. `@withstudiocms/sdk` stays 0.4.2 (its patch is unchanged), Astro stays 7.3.5.
- **New dependency: `satteri` 0.10.5** (MIT, by an Astro core maintainer, 2026-08-19): a Rust markdown
  parser shipped as prebuilt binaries in per-platform optional packages (`@bruits/satteri-*`, 3–4 MB
  each; Debian images use the `linux-*-gnu` one). npm provenance on the package and the binaries; no
  install scripts; its only other dependencies are `@types/*` packages. Removed: `micromark`,
  `micromark-extension-gfm`.

## Decision

1. **Wait for the release-age gate** (3 days): no exceptions for these packages. Prepare the branches
   now; install, test and release from 2026-10-22 19:47 UTC.
2. **Support both:** every plugin's peer range becomes `^0.6.0 || ^0.7.0` (Tapestry, media library,
   tapestry-seo, tapestry-menus), so sites on 0.6.1 can take the new releases. Development moves to 0.7.0.
3. **Tapestry ships the patch for each supported version** (`patches/studiocms@0.6.1.patch`,
   `patches/studiocms@0.7.0.patch`, the same changes); the README tells sites to copy the one matching
   their StudioCMS version.
4. **Playground:** StudioCMS 0.7.0 and `@studiocms/md` 0.5.1 with the patches renamed for those versions;
   every e2e suite, the performance budget and a production Docker build before the plugin releases.

## Consequences

- New releases needed: media library 0.2.1 and tapestry-seo 0.2.1 (peer range); Tapestry's range goes
  into its next release; tapestry-menus starts with it.
- The search API fix closes a draft-listing gap that we hadn't recorded.
