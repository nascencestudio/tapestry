# 0023. Scheduled publishing and version comparison

- Status: Accepted
- Date: 2026-10-07

## Context

Publishing follow-ups from the roadmap (ADR 0011): publish at a chosen date and
time, and compare a history entry with the live version side by side (which also
covers Phase 5's "visual diff between versions"). Constraints: StudioCMS has no
job runner or cron; pages are cached for 5 minutes; visitors must never see
unpublished content (security.md).

## Decision

### Scheduled publishing

1. The stored page (format 2) gets an optional
   `scheduled: { document, at, by? }`. Scheduling freezes a copy of the working
   version; later edits stay in the draft and aren't part of it.
2. **No background job.** A pure `applyDueSchedule(page, now)` turns a due
   schedule into a publish (published at the scheduled time, by the scheduler;
   the old version moves to history; a draft identical to it is cleared). Every
   reader applies it: the public renderer, `getPage()`, the redaction of
   StudioCMS's JSON APIs (`publicContent`), and the editor on open. So the page
   goes live on time (even through StudioCMS's page cache, since the time is
   checked on each read), and the stored content catches up on the next save.
3. Times are compared as instants (`Date.parse`), not strings.
4. UI: "Schedule…" next to Publish (date and time in the editor's time zone,
   stored in UTC, at least a minute ahead), a "Scheduled · …" pill, cancel and
   reschedule; the admin bar shows the time (UTC).
5. The date input is **detached** from StudioCMS's form (`form="tapestry-detached"`):
   its `min`/`step` constraints would otherwise make the browser silently block
   StudioCMS's Save. (The same latent problem existed for number fields with
   `min`/`max`; fixed the same way.)

### Version comparison

1. `?tapestry-version=published|draft|history-N` on the page's real URL, for
   **editors only** (ignored for visitors), renders that version with the site's
   layout and CSS, without the admin bar ("embedded" mode), `noindex`, `no-store`.
2. A pure `diffDocuments(before, after, manifest)` matches components by id and
   lists additions, removals, moves (new parent, or out of order among shared
   siblings via a longest-increasing-subsequence) and changed settings with
   readable before/after values.
3. "Compare" on each history entry opens a panel: the change list, then both
   versions side by side (earlier vs. live, or vs. the last saved draft).

## Alternatives considered

- **A cron/timer in the server** to publish: StudioCMS has none, a timer in the
  Node process misses schedules across restarts and multiple instances, and the
  read-time approach is exact and stateless.
- **Rendering versions through the render endpoint** for the comparison: it
  returns only the content markup; the real URL shows the page as visitors see it.
- **A pixel diff**: heavy (screenshots) and noisy; the change list plus side by
  side covers what editors need.

## Consequences

- Readers do a little more work (one time comparison per read).
- `publicContent()` gained a clock parameter (for tests).
- e2e: publishing suite +2 steps (compare; schedule → waits ~70 s for it to go live).
