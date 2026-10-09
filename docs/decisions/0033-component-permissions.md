# 0033. Component permissions

- Status: Accepted
- Date: 2026-10-08

## Context

Phase 5 lists "permissions (who can use which components)". Typical needs: only
admins may place or change a pricing table, a legal notice or an embed, while
editors build the rest of the page. Like publishing (ADR 0022), the editor UI alone
proves nothing: saves are plain requests to StudioCMS's endpoints.

## Decision

1. **Definition option** `permission: 'editor' | 'admin' | 'owner'` (default `editor`):
   the lowest StudioCMS role that may add, change, move or remove the component. For
   others, its instances are **locked**.
2. **One rule, editor and server:** every document someone saves (the working copy,
   the live version, a scheduled version) must leave the locked components exactly as
   they are in **some version the page already has** (live, draft, scheduled or
   history). "Exactly" means same component, version and props, and the same parent
   and slot (order among siblings may change, since others may insert around it).
   - So people below the role can still publish, restore or discard versions an admin
     made, and edit everything around and inside locked containers, but never create a
     new state of a locked component (add, change, move, remove).
   - Pure functions in `permissions.ts`: `lockedTypes()`, `lockedChanges()`,
     `matchesSomeVersion()`, `lockedMessage()`.
3. **Server:** the publish guard became `guardSaves()` (middleware, before StudioCMS):
   after the publish-permission rewrite (unchanged), it checks the rule against the
   stored page from the database and **refuses** violations with 403 and a message
   ("Only admins can change “Hero”."). Same body matching as before (dashboard and
   REST shapes, any path spelling); new pages are checked against an empty page.
4. **Editor (UI only):** the store refuses commits that break the rule (covering every
   path: settings, keyboard, drag and drop, paste, patterns, canvas) and shows a
   notice. Locked components show a lock in the page structure and the library (and
   can't be dragged or added), their settings are read-only (disabled fieldset;
   read-only rich text), and the canvas doesn't drag, duplicate, delete or inline-edit
   them. Names and "Save as pattern" stay available.

## Alternatives considered

- **Strict "never differs from the current working copy":** would stop editors from
  publishing an admin's draft or restoring history.
- **Hiding locked components from editors:** they're on the page; editors need to see
  and arrange around them.
- **Rewriting violating saves** (like the publish guard): the right version to keep
  per component is ambiguous; refusing is clear, and the editor never sends such saves.

## Consequences

- One more check per Tapestry save, only for users who have locked components.
- The editor learns the user's role (`data-user-level`); the server doesn't trust it.
- Playground: the Hero is admin-only. e2e: the permissions suite's editor account sees
  it locked and a crafted change is refused (7 steps).
