# 0022. A publish permission separate from edit

- Status: Accepted
- Date: 2026-10-07

## Context

Publishing (ADR 0011) is available to everyone who can edit. The roadmap asked
for the common split "editors draft, admins publish". In StudioCMS, publishing a
Tapestry page is nothing more than saving its stored content (format 2) through
StudioCMS's own endpoints, so the permission can't live in the editor UI alone:
anyone with an editor account can send any content with a crafted request.

## Decision

1. **Option** `tapestry({ publishPermission: 'editor' | 'admin' | 'owner' })`,
   default `'editor'` (unchanged behavior). The playground uses `'admin'`.
2. **Editor UI:** below that role, Publish and Schedule are disabled with an
   explanation ("Only admins can publish. Save a draft and ask them to publish
   it."). `Editor.astro` computes it from the session; the UI is only a courtesy.
3. **Server enforcement** in Tapestry's middleware (`runtime/publish-guard.ts`),
   only when the option isn't `'editor'`: for a logged-in editor below the role,
   every JSON `POST`/`PUT`/`PATCH` whose payload carries page content for a
   Tapestry page is **rewritten** before StudioCMS sees it
   (`next(rewrittenRequest)`): the live version, its date and author, the
   history and the schedule come from the **database** (not StudioCMS's 5-minute
   page cache); only the sender's working copy is kept, as the draft
   (`keepPublishingState`, pure, unit-tested).
   - Detection by body, not path (StudioCMS's router accepts many spellings):
     the dashboard's `{ id, content }` and the REST API's
     `{ data: { id }, content: { content } }`.
   - A page counts as Tapestry if the stored page's type is `tapestry/canvas`,
     the payload says so, or the content looks like Tapestry content (format 2,
     or format 1, which renders as published).
   - Covers: publishing, unpublishing (empty content), forged history, forged
     schedules, the old single-document format. A save that looks like Tapestry
     content but can't be tied to an existing page (other than a create) is
     refused with 403.
   - Rewriting instead of refusing means drafts always save, and a stale tab
     can't overwrite someone else's newer publish either.

## Alternatives considered

- **Reject (403) any save whose publishing state differs.** Simpler, but a
  non-publisher's tab that's open while an admin publishes (or while a schedule
  becomes due) would fail to save until reloaded.
- **Patch StudioCMS's save handler.** Works only for the dashboard route, and adds
  patch surface; the middleware covers the REST API too.
- **Separate "submit for review" workflow** (Drupal's content moderation):
  larger feature; the draft + admin publish covers the request.

## Consequences

- No cost with the default; with `'admin'`/`'owner'`, one session check per JSON
  write, plus two indexed lookups for Tapestry page saves by non-publishers.
- e2e suite `permissions` (6 steps) creates a temporary editor account through
  StudioCMS's API and deletes it afterwards. That uncovered StudioCMS's inverted
  ghost-user check, which made **every** user undeletable (known issue #35,
  patched).
