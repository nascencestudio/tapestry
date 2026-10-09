/**
 * Pure, immutable operations on a Tapestry document tree.
 *
 * Every function returns a new document (structurally shared with the input)
 * and never mutates its arguments, which makes undo/redo a matter of keeping
 * old documents. Operations that would produce an invalid tree (a node inside
 * itself, children under a component that doesn't accept them) return `null`.
 */
import { richTextFromPlain, richTextToPlain } from '../richtext.js';
import { canonicalNode, childAreas, firstArea, hasArea, hasChildAreas, sortByArea } from '../slots.js';
import type {
	ComponentManifest,
	FieldDefinition,
	FieldValue,
	ObjectValue,
	PropDefinition,
	PropValue,
	RichTextDoc,
	TapestryDocument,
	TapestryNode,
} from '../types.js';
import { cleanLinkValue, cleanNodeLabel, cleanRichTextProp, defaultValue, validateDocument } from '../validate.js';

/**
 * Where a node lives or should go: a parent (`null` = page root), an index in
 * its children, and for parents with named slots, the slot (absent = the
 * default area). Children stay grouped by slot, so the index only orders a
 * node among the children of the same slot.
 */
export interface Target {
	parentId: string | null;
	index: number;
	slot?: string;
}

export interface NodeLocation extends Target {
	node: TapestryNode;
	/** Ids from the root down to the parent (empty for top-level nodes). */
	ancestors: string[];
}

function childrenOf(doc: TapestryDocument, parentId: string | null): TapestryNode[] | undefined {
	if (parentId === null) return doc.root;
	const location = findNode(doc, parentId);
	return location ? (location.node.children ?? []) : undefined;
}

/** Find a node and its position. Depth-first; O(n). */
export function findNode(doc: TapestryDocument, id: string): NodeLocation | null {
	const walk = (nodes: TapestryNode[], parentId: string | null, ancestors: string[]): NodeLocation | null => {
		for (let index = 0; index < nodes.length; index++) {
			const node = nodes[index] as TapestryNode;
			if (node.id === id) return { node, parentId, index, ancestors };
			if (node.children) {
				const found = walk(node.children, node.id, [...ancestors, node.id]);
				if (found) return found;
			}
		}
		return null;
	};
	return walk(doc.root, null, []);
}

/** All node ids in document order. */
export function allIds(doc: TapestryDocument): string[] {
	const ids: string[] = [];
	const walk = (nodes: TapestryNode[]) => {
		for (const node of nodes) {
			ids.push(node.id);
			if (node.children) walk(node.children);
		}
	};
	walk(doc.root);
	return ids;
}

/** True if `id` is `ancestorId` itself or nested anywhere inside it. */
export function isSelfOrDescendant(doc: TapestryDocument, ancestorId: string, id: string): boolean {
	if (ancestorId === id) return true;
	return findNode(doc, id)?.ancestors.includes(ancestorId) ?? false;
}

/** Whether a parent (`null` = root) can hold children in `slot` (absent = the default area). */
export function acceptsChildren(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	parentId: string | null,
	slot?: string,
): boolean {
	if (parentId === null) return slot === undefined;
	const parent = findNode(doc, parentId)?.node;
	return Boolean(parent && hasArea(manifest[parent.type], slot));
}

/** The manifest entry of a parent (undefined for the root). */
function parentEntry(doc: TapestryDocument, manifest: ComponentManifest, parentId: string | null) {
	if (parentId === null) return undefined;
	const parent = findNode(doc, parentId)?.node;
	return parent ? manifest[parent.type] : undefined;
}

/** Replace the children list of `parentId` (or the root) using `update`. */
function withChildren(
	doc: TapestryDocument,
	parentId: string | null,
	update: (children: TapestryNode[]) => TapestryNode[],
): TapestryDocument {
	if (parentId === null) return { ...doc, root: update(doc.root) };
	const rewrite = (nodes: TapestryNode[]): TapestryNode[] => {
		let changed = false;
		const next = nodes.map((node) => {
			if (node.id === parentId) {
				changed = true;
				return { ...node, children: update(node.children ?? []) };
			}
			if (node.children) {
				const children = rewrite(node.children);
				if (children !== node.children) {
					changed = true;
					return { ...node, children };
				}
			}
			return node;
		});
		return changed ? next : nodes;
	};
	return { ...doc, root: rewrite(doc.root) };
}

function clampIndex(index: number, length: number): number {
	return Math.max(0, Math.min(index, length));
}

/** Insert `node` at `target`. Returns null if the parent doesn't exist or can't hold children. */
export function insertNode(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	node: TapestryNode,
	target: Target,
): TapestryDocument | null {
	if (!acceptsChildren(doc, manifest, target.parentId, target.slot)) return null;
	if (childrenOf(doc, target.parentId) === undefined) return null;
	const placed = node.slot === target.slot ? node : canonicalNode({ ...node, slot: target.slot });
	const entry = parentEntry(doc, manifest, target.parentId);
	return withChildren(doc, target.parentId, (children) => {
		const next = [...children];
		next.splice(clampIndex(target.index, children.length), 0, placed);
		return sortByArea(next, entry);
	});
}

/** Remove a node (and its subtree). Returns null if it doesn't exist. */
export function removeNode(doc: TapestryDocument, id: string): TapestryDocument | null {
	const location = findNode(doc, id);
	if (!location) return null;
	return withChildren(doc, location.parentId, (children) => children.filter((c) => c.id !== id));
}

/**
 * Move a node to `target`, where `target.index` is interpreted **before**
 * removal (i.e. as it appears in the current tree). Returns null for moves into
 * itself or its descendants, into a parent that doesn't accept children, or
 * moves that change nothing.
 */
export function moveNode(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	id: string,
	target: Target,
): TapestryDocument | null {
	const from = findNode(doc, id);
	if (!from) return null;
	if (target.parentId !== null && isSelfOrDescendant(doc, id, target.parentId)) return null;
	if (!acceptsChildren(doc, manifest, target.parentId, target.slot)) return null;

	let index = target.index;
	const sameParent = from.parentId === target.parentId;
	if (sameParent && from.index < index) index -= 1;
	if (sameParent && from.index === index && from.node.slot === target.slot) return null;

	const removed = removeNode(doc, id);
	const moved =
		removed && insertNode(removed, manifest, from.node, { parentId: target.parentId, index, slot: target.slot });
	// Grouping by slot can put it back where it was: nothing changed.
	return moved && JSON.stringify(moved) !== JSON.stringify(doc) ? moved : null;
}

/**
 * Merge `patch` into a node's props. A value of `undefined` removes that prop.
 * Returns null if the node doesn't exist.
 */
export function updateProps(
	doc: TapestryDocument,
	id: string,
	patch: Record<string, PropValue | undefined>,
): TapestryDocument | null {
	const location = findNode(doc, id);
	if (!location) return null;
	const props = { ...location.node.props };
	for (const [key, value] of Object.entries(patch)) {
		if (value === undefined) delete props[key];
		else props[key] = value;
	}
	return withChildren(doc, location.parentId, (children) =>
		children.map((child) => (child.id === id ? { ...child, props } : child)),
	);
}

/** Generate an id unique within `taken`, e.g. `hero-k3f9x2`. */
export function generateId(type: string, taken: ReadonlySet<string>): string {
	const prefix = type.slice(0, 40);
	for (;;) {
		const bytes = crypto.getRandomValues(new Uint8Array(6));
		const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
		const id = `${prefix}-${suffix}`;
		if (!taken.has(id)) return id;
	}
}

/**
 * A starting value for a prop on a freshly added component. Uses the declared
 * default; for required props without one, picks a value that passes
 * validation so a new node is never silently dropped by the renderer.
 */
export function initialPropValue(def: PropDefinition): PropValue | undefined {
	if (def.type === 'object' || def.type === 'list') {
		if (def.default !== undefined) return defaultValue(def);
		if (def.type === 'object') {
			const value = initialObject(def.fields);
			return def.required || Object.keys(value).length > 0 ? value : undefined;
		}
		const count = Math.max(def.minItems ?? 0, def.required ? 1 : 0);
		return count > 0 ? Array.from({ length: count }, () => initialObject(def.fields)) : undefined;
	}
	if (def.type === 'richtext') {
		if (def.default !== undefined) return cleanRichTextProp(def, def.default).value;
		return def.required ? richTextFromPlain(def.label) : undefined;
	}
	if (def.type === 'link') {
		if (def.default !== undefined) return cleanLinkValue(def.default) ?? undefined;
		return def.required ? { type: 'url', url: '#' } : undefined;
	}
	if (def.default !== undefined) return def.default;
	if (!def.required) return undefined;
	switch (def.type) {
		case 'text':
		case 'textarea':
			return def.label.slice(0, def.maxLength ?? 500);
		case 'url':
			return '#';
		case 'number':
			return def.min ?? 0;
		case 'boolean':
			return false;
		case 'select':
			return def.options[0]?.value ?? '';
		case 'media':
			return undefined; // chosen from the media library; until then the field shows as required
	}
}

/** Starting field values for a new object or list item (defaults, placeholders for required fields). */
export function initialObject(fields: Record<string, FieldDefinition>): ObjectValue {
	const value: ObjectValue = {};
	for (const [name, field] of Object.entries(fields)) {
		const initial = initialPropValue(field);
		if (initial !== undefined) value[name] = initial as FieldValue;
	}
	return value;
}

/** Create a new node of `type` with initial props. Returns null for unknown types. */
export function createNode(manifest: ComponentManifest, type: string, taken: ReadonlySet<string>): TapestryNode | null {
	const entry = Object.hasOwn(manifest, type) ? manifest[type] : undefined;
	if (!entry) return null;
	const props: Record<string, PropValue> = {};
	for (const [name, def] of Object.entries(entry.props ?? {})) {
		const value = initialPropValue(def);
		if (value !== undefined) props[name] = value;
	}
	const node: TapestryNode =
		(entry.version ?? 1) > 1
			? { id: generateId(type, taken), type, version: entry.version, props }
			: { id: generateId(type, taken), type, props };
	if (hasChildAreas(entry)) node.children = [];
	return node;
}

/** Deep-copy a subtree giving every node a fresh id. */
function cloneWithNewIds(node: TapestryNode, taken: Set<string>): TapestryNode {
	const id = generateId(node.type, taken);
	taken.add(id);
	const clone: TapestryNode = node.label
		? { id, type: node.type, label: node.label, props: { ...node.props } }
		: { id, type: node.type, props: { ...node.props } };
	if (node.children) clone.children = node.children.map((child) => cloneWithNewIds(child, taken));
	return clone;
}

/** Duplicate a node (with fresh ids) right after the original. */
export function duplicateNode(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	id: string,
): { doc: TapestryDocument; id: string } | null {
	const location = findNode(doc, id);
	if (!location) return null;
	const clone = cloneWithNewIds(location.node, new Set(allIds(doc)));
	const next = insertNode(doc, manifest, clone, {
		parentId: location.parentId,
		index: location.index + 1,
		slot: location.node.slot,
	});
	return next && { doc: next, id: clone.id };
}

/**
 * Where "add component" should insert, relative to the current selection:
 * inside a selected container (at the end), else right after the selected
 * node, else at the end of the page.
 */
export function insertionTargetFor(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	selectedId: string | null,
): Target {
	const selected = selectedId ? findNode(doc, selectedId) : null;
	if (!selected) return { parentId: null, index: doc.root.length };
	const entry = manifest[selected.node.type];
	if (hasChildAreas(entry)) {
		// The end of its first area (the default one, if it has one).
		return areaEnd(selected.node, firstArea(entry));
	}
	return { parentId: selected.parentId, index: selected.index + 1, slot: selected.node.slot };
}

/** Target at the end of one area of `parent`. */
function areaEnd(parent: TapestryNode, slot: string | undefined): Target {
	const children = parent.children ?? [];
	let index = children.length;
	for (let i = children.length - 1; i >= 0; i--) {
		if (children[i]?.slot === slot) {
			index = i + 1;
			break;
		}
	}
	return slot === undefined ? { parentId: parent.id, index } : { parentId: parent.id, index, slot };
}

/** Keyboard-style moves for accessibility: up, down, into the previous sibling, out of the parent. */
export function nudgeTarget(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	id: string,
	direction: 'up' | 'down' | 'indent' | 'outdent',
): Target | null {
	const location = findNode(doc, id);
	if (!location) return null;
	const siblings = childrenOf(doc, location.parentId) ?? [];
	const { parentId, index } = location;
	const slot = location.node.slot;
	const at = (target: Target): Target => (target.slot === undefined ? { parentId, index: target.index } : target);
	switch (direction) {
		case 'up': {
			const previous = siblings[index - 1];
			if (!previous) return null;
			// The first in a slot moves to the end of the previous slot.
			if (previous.slot !== slot) return at({ parentId, index, slot: previous.slot });
			return at({ parentId, index: index - 1, slot });
		}
		case 'down': {
			const next = siblings[index + 1];
			if (!next) return null;
			// The last in a slot moves to the start of the next slot.
			if (next.slot !== slot) return at({ parentId, index, slot: next.slot });
			// +2 because move targets are expressed before removal.
			return at({ parentId, index: index + 2, slot });
		}
		case 'indent': {
			const previous = siblings[index - 1];
			const areas = childAreas(previous ? manifest[previous.type] : undefined);
			if (!previous || areas.length === 0) return null;
			// The end of its last area: the one nearest to where the node is now.
			return areaEnd(previous, areas[areas.length - 1]);
		}
		case 'outdent': {
			if (parentId === null) return null;
			const parent = findNode(doc, parentId);
			if (!parent) return null;
			const target: Target = { parentId: parent.parentId, index: parent.index + 1 };
			if (parent.node.slot !== undefined) target.slot = parent.node.slot;
			return target;
		}
	}
}

/** Short human-readable summary of a node for the layer tree, from its first non-empty text prop. */
export function nodeSummary(manifest: ComponentManifest, node: TapestryNode, maxLength = 48): string {
	const entry = manifest[node.type];
	for (const [name, def] of Object.entries(entry?.props ?? {})) {
		if (def.type !== 'text' && def.type !== 'textarea' && def.type !== 'richtext') continue;
		const raw = node.props[name];
		const value = typeof raw === 'object' && 'content' in raw ? richTextToPlain(raw as RichTextDoc) : raw;
		if (typeof value === 'string' && value.trim()) {
			const flat = value.replace(/\s+/g, ' ').trim();
			return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
		}
	}
	return '';
}

/** Ids in document order, leaving out the descendants of collapsed containers (what the layer tree shows). */
export function visibleIds(doc: TapestryDocument, collapsed: ReadonlySet<string>): string[] {
	const ids: string[] = [];
	const walk = (nodes: TapestryNode[]) => {
		for (const node of nodes) {
			ids.push(node.id);
			if (node.children && !collapsed.has(node.id)) walk(node.children);
		}
	};
	walk(doc.root);
	return ids;
}

/** Set or clear (`''`) a node's editor-only label. Keeps the canonical key order. Null if unchanged or missing. */
export function setNodeLabel(doc: TapestryDocument, id: string, label: string): TapestryDocument | null {
	const location = findNode(doc, id);
	if (!location) return null;
	const clean = cleanNodeLabel(label);
	if ((location.node.label ?? '') === clean) return null;
	const { label: _old, ...rest } = location.node;
	const next = canonicalNode(clean ? { ...rest, label: clean } : rest);
	return withChildren(doc, location.parentId, (siblings) => siblings.map((n) => (n.id === id ? next : n)));
}

/** Clipboard format for copied nodes (plain JSON text, so it works across pages and tabs). */
export const CLIPBOARD_KIND = 'tapestry/nodes';

/** Serialize a node (with its subtree) for the clipboard. */
export function copyPayload(node: TapestryNode): string {
	return JSON.stringify({ kind: CLIPBOARD_KIND, version: 1, nodes: [node] });
}

/**
 * Nodes from clipboard text, validated against the manifest like any stored
 * content (unknown components and bad props dropped) and given fresh ids that
 * don't clash with `taken`. Null if the text isn't a Tapestry clipboard payload
 * or nothing valid is left.
 */
export function nodesFromClipboard(
	text: string,
	manifest: ComponentManifest,
	taken: ReadonlySet<string>,
): TapestryNode[] | null {
	if (text.length > 1_000_000) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof parsed !== 'object' || parsed === null) return null;
	const payload = parsed as { kind?: unknown; nodes?: unknown };
	if (payload.kind !== CLIPBOARD_KIND || !Array.isArray(payload.nodes)) return null;
	return freshCopies(payload.nodes, manifest, taken);
}

/**
 * Copies of nodes to insert (from the clipboard or a pattern): validated like
 * stored content (unknown components and bad props dropped) and given fresh ids
 * that don't clash with `taken`. Null if nothing valid is left.
 */
export function freshCopies(
	nodes: unknown[],
	manifest: ComponentManifest,
	taken: ReadonlySet<string>,
): TapestryNode[] | null {
	const { document } = validateDocument({ version: 1, root: nodes }, manifest);
	if (document.root.length === 0) return null;
	const ids = new Set(taken);
	return document.root.map((node) => cloneWithNewIds(node, ids));
}

/** Insert several nodes in order at `target`. Null if any can't go there. */
export function insertNodes(
	doc: TapestryDocument,
	manifest: ComponentManifest,
	nodes: TapestryNode[],
	target: Target,
): TapestryDocument | null {
	let next: TapestryDocument | null = doc;
	nodes.forEach((node, offset) => {
		next = next && insertNode(next, manifest, node, { ...target, index: target.index + offset });
	});
	return next;
}
