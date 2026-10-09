/**
 * Component permissions (ADR 0033): a component can require a role
 * (`permission: 'admin' | 'owner'`) to be added, changed, moved or removed.
 * For people below that role its instances are locked: the editor shows them
 * read-only, and the server refuses saves that change them.
 *
 * The rule, used by the editor and the server alike: every document someone
 * saves must leave the locked components exactly as they are in **some version
 * the page already has** (live, draft, scheduled or history). So they can still
 * publish, restore or discard versions an admin made, but never create a new
 * state of a locked component. Pure functions.
 */
import { hasPermission, type PermissionLevel } from './access.js';
import type { ComponentManifest, ComponentManifestEntry, TapestryDocument, TapestryNode } from './types.js';

/** Roles a component can require (`editor` is everyone who can edit). */
export const COMPONENT_PERMISSIONS = ['editor', 'admin', 'owner'] as const;
export type ComponentPermission = (typeof COMPONENT_PERMISSIONS)[number];

export function canUseComponent(entry: ComponentManifestEntry | undefined, level: PermissionLevel | string): boolean {
	return hasPermission(level, entry?.permission ?? 'editor');
}

/** Component types locked for someone with `level`. */
export function lockedTypes(manifest: ComponentManifest, level: PermissionLevel | string): Set<string> {
	return new Set(Object.values(manifest).flatMap((entry) => (canUseComponent(entry, level) ? [] : [entry.type])));
}

export interface LockedChange {
	id: string;
	type: string;
	change: 'added' | 'removed' | 'changed' | 'moved';
}

/** What a locked node is: component, version, props, and where it sits (parent and slot). */
function signatures(
	doc: TapestryDocument,
	locked: ReadonlySet<string>,
): Map<string, { type: string; key: string; place: string }> {
	const map = new Map<string, { type: string; key: string; place: string }>();
	const walk = (nodes: readonly TapestryNode[], parent: string) => {
		for (const node of nodes) {
			if (locked.has(node.type)) {
				map.set(node.id, {
					type: node.type,
					key: JSON.stringify([node.type, node.version ?? 1, node.props]),
					place: `${parent}|${node.slot ?? ''}`,
				});
			}
			if (node.children) walk(node.children, node.id);
		}
	};
	walk(doc.root, '');
	return map;
}

/** How `after` differs from `before` on locked components (empty: no difference). */
export function lockedChanges(
	before: TapestryDocument,
	after: TapestryDocument,
	locked: ReadonlySet<string>,
): LockedChange[] {
	if (locked.size === 0) return [];
	const a = signatures(before, locked);
	const b = signatures(after, locked);
	const changes: LockedChange[] = [];
	for (const [id, old] of a) {
		const now = b.get(id);
		if (!now) changes.push({ id, type: old.type, change: 'removed' });
		else if (now.key !== old.key) changes.push({ id, type: old.type, change: 'changed' });
		else if (now.place !== old.place) changes.push({ id, type: old.type, change: 'moved' });
	}
	for (const [id, now] of b) if (!a.has(id)) changes.push({ id, type: now.type, change: 'added' });
	return changes;
}

/** True when `doc` leaves the locked components as in at least one of `versions`. */
export function matchesSomeVersion(
	doc: TapestryDocument,
	versions: readonly TapestryDocument[],
	locked: ReadonlySet<string>,
): boolean {
	return locked.size === 0 || versions.some((version) => lockedChanges(version, doc, locked).length === 0);
}

/** A message for the first change, e.g. "Only admins can change “Pricing table”." */
export function lockedMessage(change: LockedChange, manifest: ComponentManifest): string {
	const entry = manifest[change.type];
	const role = entry?.permission === 'owner' ? 'the owner' : `${entry?.permission ?? 'admin'}s`;
	const verb = { added: 'add', removed: 'remove', changed: 'change', moved: 'move' }[change.change];
	return `Only ${role} can ${verb} “${entry?.label ?? change.type}”.`;
}
