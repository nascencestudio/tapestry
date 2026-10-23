# 0045. Shipped patches cover StudioCMS bugs sites hit, including the SDK

- Status: Accepted (the user's decision, 2026-10-22)
- Date: 2026-10-22

## Context

Tapestry ships a StudioCMS patch per supported version (ADRs 0030, 0043) because sites need it for Tapestry to
work: component scripts (#37) and dashboard pages (#38). The mail fixes (#39, #40) joined it for webforms. On
2026-10-22 the user found two taxonomy bugs that have nothing to do with Tapestry but break sites badly:

- #42: new tags and categories can't be created (the form drops `id` and `meta`).
- #43: once a page has a tag or category, it fails to load, and so does every request that lists pages
  (logins included). This one is in `@withstudiocms/sdk` 0.4.2, not in `studiocms`.

Neither is known upstream: no issue or pull request, and StudioCMS's `main` still has both (checked
2026-10-22). The playground already patched the SDK (user deletion, #35).

## Decision

1. Tapestry's StudioCMS patches carry the fixes sites need to use StudioCMS's own features, not only
   Tapestry's: the taxonomy create fix (#42) goes into `studiocms@0.6.1.patch` and `@0.7.0.patch`.
2. Tapestry also ships `patches/@withstudiocms__sdk@0.4.2.patch` (#43 and #35). StudioCMS 0.6.1 and 0.7.0
   both use SDK 0.4.2, so one file serves both.
3. pnpm allows one patch per package, so the SDK patch is the playground's file, kept identical. The
   playground's StudioCMS patch stays a superset (its dev-only fixes, #12 and #32, aren't shipped).
4. Every shipped fix is checked by applying each patch to the verified npm tarball and by a pnpm install of
   both StudioCMS versions with the README's `patchedDependencies`.

## Alternatives considered

- Leave taxonomy fixes to the playground and document the hunks: sites would find out after a page broke.
- A separate fixes package: more to install and release for a handful of lines.

## Consequences

- Sites copy two patch files (README). Each StudioCMS or SDK upgrade needs new files or drops fixed ones.
- Report upstream when the user asks; remove each fix once StudioCMS releases it.
