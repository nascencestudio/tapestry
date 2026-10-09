# 0008. Browser end-to-end tests with a dependency-free CDP harness

- Status: Accepted
- Date: 2026-10-02

## Context

The editor must be tested in a real browser: native drag and drop, focus and
keyboard handling, and the save round trip through StudioCMS's dashboard can't
be unit-tested meaningfully. The usual choice, Playwright, adds a large
dependency, downloads browser binaries, and runs install scripts. All of that
cuts against our supply-chain policy (ADR 0003).

## Decision

Drive a locally installed Chrome over the **Chrome DevTools Protocol**, using
Node 22's built-in `WebSocket`. The harness ([`playground/e2e/cdp.mjs`](https://github.com/nascencestudio/tapestry-playground/blob/main/e2e/cdp.mjs),
about 300 lines) provides navigation, evaluation, real mouse and keyboard input
(`Input.dispatch*`), native drag and drop (`Input.setInterceptDrags` +
`Input.dispatchDragEvent`), and screenshots.

The editor suite ([`playground/e2e/editor.e2e.mjs`](https://github.com/nascencestudio/tapestry-playground/blob/main/e2e/editor.e2e.mjs))
runs against the dev server with `pnpm e2e`.

## Alternatives considered

- **Playwright**: best-in-class, but heavy, with browser downloads and install
  scripts. Reconsider for cross-browser (Firefox/WebKit) coverage or CI.
- **Puppeteer**: smaller, but still downloads Chrome by default and brings a
  dependency tree.
- **Manual testing only**: is how the save round trip went unverified in session 1.

## Consequences

- Zero new dependencies; tests use the same Chrome developers already have.
- Chrome-only coverage for now.
- We maintain a small protocol client. It's deliberately minimal; add helpers
  only as tests need them.
- Two drag helpers: `page.drag()` uses CDP drag interception
  (`Input.setInterceptDrags`), which only catches drags that start in the
  top-level frame (library/layers → canvas). `page.realDrag()` sends genuine mouse
  input without interception, so the browser runs a real drag; use it for drags
  that start inside the canvas iframe. Resolve both points *before* pressing:
  a scroll between the press and the first move cancels the pending drag.
- An earlier version tested chip drags with synthetic `DragEvent`s. That passed
  while the real gesture was broken (see ADR 0010). Prefer real input.
- Errors whose stack comes from StudioCMS's dev-toolbar code are ignored (dev-only
  noise; known issue #12). Matching is by source URL, never by message text.
- Requires a running dev server and a completed StudioCMS setup. Credentials
  come from `playground/.dev-credentials` or `TAPESTRY_E2E_USER` / `TAPESTRY_E2E_PASSWORD`.
