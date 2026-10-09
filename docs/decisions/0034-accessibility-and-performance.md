# 0034. Accessibility audit and performance budget

- Status: Accepted
- Date: 2026-10-08

## Context

Phase 5 lists "accessibility audit of the editor; performance budget for public
pages". Both need to keep holding as features are added, so each gets an automated
check in the regular test runs, not just a one-off review.

## Decision

### Accessibility

1. **axe-core in the e2e harness** (suite `a11y`): WCAG 2.2 A/AA plus axe's best
   practices, on the public page as a visitor, and on Tapestry's own UI in the editor in
   many states (settings, link and list fields, a field error, rich text, the three
   popovers, history, compare, schedule, JSON view, save as pattern) and on the media
   library's page, in **both** dashboard themes. StudioCMS's own dashboard chrome is out
   of scope. The suite restores the dark theme afterwards (StudioCMS saves it per user).
2. **Fixes from the audit:**
   - Heading outline: a visually hidden `<h2>Visual editor</h2>` between StudioCMS's
     `<h1>` and the panel titles (`<h3>`).
   - Contrast: StudioCMS's status colors are meant as backgrounds, so status pills now
     use normal text with the status color as border and dot. Tapestry's danger color is
     its own, readable as text in each theme (StudioCMS's `--danger-base` is very dark
     red in its dark theme). The media library's primary button and active filter use
     `--text-inverted` (black on the dark theme's light purple).
   - Reduced motion: the editor's two transitions are off under
     `prefers-reduced-motion: reduce`.
3. **Manual review** (what axe can't judge), already covered by e2e steps: keyboard
   equivalents for every drag and drop (tree and canvas), focus kept or moved on
   purpose (list moves, popovers return focus to their button, new list items take
   focus), live-region announcements for structural changes and refused (locked)
   changes, visible focus on every control (white rings on the purple Components panel).

### Performance budget

1. `playground/scripts/check-budget.mjs` (`pnpm budget`) measures what an anonymous
   visitor downloads from a **production** server: HTML, all CSS and JS (inline and
   linked, following module imports and island code), gzipped, plus the request count.
   It checks the demo home page (no islands) and a throwaway page with one Counter
   island, against `playground/perf-budget.json`.
2. Budgets (measured 2026-10-08 in brackets): home ≤ 3 KB HTML [1.3], ≤ 4 KB CSS [1.5],
   ≤ 1 KB JS [0.2: StudioCMS UI's transition polyfill], ≤ 4 requests [3]; island page ≤ 5 KB
   HTML [2.9], ≤ 4 KB CSS [1.6], ≤ 12 KB JS [8.0], ≤ 12 requests [9].
3. CI runs it in the e2e job after the suites (production build, same database).

## Dependency review: `axe-core` (playground dev dependency only)

| Package | Version | Provenance | Notes |
| --- | --- | --- | --- |
| `axe-core` | **4.13.0** (2026-08-05) | ✓ SLSA v1 | No dependencies. 3.4 MB unpacked (one 580 KB script injected into test pages). MPL-2.0 (file-level copyleft; we don't modify or ship it). 4.14.0 (2026-10-05) is inside the 3-day release-age window. |

Never shipped to sites or the editor; only the e2e harness reads it.

## Alternatives considered

- **Lighthouse** for both: heavy (a Chrome dependency tree of its own), slow, and its
  scores are noisier than byte budgets and axe's rule results.
- **Pa11y**: wraps axe with more dependencies.
- **A size budget on build output** instead of downloads: misses what pages actually
  load (inline styles, island code) and counts code no page uses.

## Consequences

- New UI states should be added to the a11y suite when they're built.
- A page growing past its budget fails CI; raising a budget needs a devlog note.
