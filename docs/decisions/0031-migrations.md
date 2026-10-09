# 0031. Document and component migrations

- Status: Accepted
- Date: 2026-10-07

## Context

Phase 5 lists "document migrations framework (version 2+)". Stored pages outlive
the code that wrote them. Two kinds of change break them:

1. **Tapestry's document format** changes (`version` in the document).
2. **A developer changes a component**: renames a prop, changes its shape (a
   `url` prop becoming an object), or renames the component. This is the common
   case and, until now, had no answer: validation would just drop the old props.

Constraints: content is validated on every read (rendering, editor, clipboard,
patterns), the manifest reaches runtime as JSON (functions don't survive), and
documents are compared as JSON strings (key order matters).

## Decision

1. **Lazy migration on read.** Migrations run inside `validateDocument()`, so every
   reader gets current content, and a page is saved in the new shape the next time
   it's edited. No batch job rewrites live pages.
2. **Component versions.** `defineComponent({ version: 2, migrations: './x.migrations.mjs' })`.
   The module's default export maps versions to pure functions:
   `{ 2: (props) => newProps }`; each upgrades props saved with the previous version
   (versions without an entry need no prop changes).
   - Nodes record the version they were saved with: `version`, written **only when
     above 1**, in canonical key order (`id, type, version, label, slot, props,
     children`). Existing content stays byte-identical; new nodes get the current
     version.
   - Migrations get a **copy** of the props (`structuredClone`); the result is then
     cleaned by the normal validation, so a migration can't smuggle in bad values.
   - A throwing migration (or one that doesn't return an object) keeps the props
     from before it and reports an error; validation cleans them. Content saved with
     a newer component version than installed (a rolled-back deploy) is kept and
     validated, with a warning.
   - `replaces: ['old-type']` hands nodes of a renamed component to the new one
     (warning in the issues). One old type maps to one component, and it can't be a
     registered type (checked in `toManifest()`).
3. **Getting the functions to runtime.** `virtual:tapestry/manifest` is generated as
   JavaScript: the JSON manifest plus `manifest[type].migrate = M0`, importing each
   component's `migrations` module (path relative to the project root, like
   `component`). The same manifest reaches the server and the editor, so migration
   modules must be plain, side-effect-free JavaScript.
4. **Format migrations.** `migrateFormat()` with a registry `FORMAT_MIGRATIONS`
   (empty: format 1 is the first), run in order from the stored version to
   `CURRENT_FORMAT`. A **newer** format than the code knows is refused (empty page,
   error issue) rather than guessed at. **2 is reserved**: the stored page wrapper is
   `version: 2` and shares the number space, so the next document format is 3.

## Alternatives considered

- **Batch migration** ("upgrade all pages" in the dashboard): rewrites published
  content and history, needs locking against concurrent edits, and gives nothing the
  lazy approach doesn't (the output is the same). Could be added later as an
  optimization.
- **Document-level component versions** (`components: { hero: 2 }`): breaks for
  copied nodes (clipboard, patterns) that come from documents with other versions.
- **Inline functions in the definition**: nicer to write, but the definitions are
  only available to the plugin at config time; a module path (like `component`) can be
  imported into the generated manifest.

## Consequences

- Developers can evolve components without breaking pages: bump `version`, write the
  step, keep it forever (old pages may still be at any version).
- Pattern and clipboard content is migrated too (it goes through validation).
- Playground: the Counter is at version 2 (`start` → `initial`). e2e suite
  `migrations` (4 steps): a v1 page renders upgraded, the editor shows it upgraded,
  and an edit saves version 2.
