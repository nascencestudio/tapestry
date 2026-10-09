/**
 * What changed between two versions of a page, for the version comparison:
 * components added, removed or moved, and settings changed (with readable
 * before/after values). Nodes are matched by id, which survives edits, moves
 * and publishing. Pure functions only.
 */
import { richTextToPlain } from '../richtext.js';
import { areaLabel } from '../slots.js';
import type {
	ComponentManifest,
	LinkValue,
	ObjectValue,
	PropDefinition,
	PropValue,
	RichTextDoc,
	TapestryDocument,
	TapestryNode,
} from '../types.js';

export interface NodeRef {
	id: string;
	type: string;
	/** "Hero", or "Hero – Pricing" when the node has a name. */
	label: string;
	/** Where it is, e.g. "Section › Columns" (empty at the top level). */
	path: string;
}

export interface PropChange {
	prop: string;
	label: string;
	before: string;
	after: string;
}

export interface DocumentDiff {
	added: NodeRef[];
	removed: NodeRef[];
	moved: NodeRef[];
	changed: Array<NodeRef & { props: PropChange[] }>;
}

interface Indexed {
	node: TapestryNode;
	parentId: string | null;
	path: string;
}

const MAX_TEXT = 120;

function index(doc: TapestryDocument, manifest: ComponentManifest): Map<string, Indexed> {
	const map = new Map<string, Indexed>();
	const walk = (nodes: TapestryNode[], parent: TapestryNode | null, path: string[]) => {
		for (const node of nodes) {
			// "Two columns › Right column" for nodes in a named slot.
			const where = parent && node.slot !== undefined ? [...path, areaLabel(manifest[parent.type], node.slot)] : path;
			map.set(node.id, { node, parentId: parent?.id ?? null, path: where.join(' › ') });
			if (node.children) walk(node.children, node, [...where, manifest[node.type]?.label ?? node.type]);
		}
	};
	walk(doc.root, null, []);
	return map;
}

function ref(entry: Indexed, manifest: ComponentManifest): NodeRef {
	const type = manifest[entry.node.type]?.label ?? entry.node.type;
	return {
		id: entry.node.id,
		type: entry.node.type,
		label: entry.node.label ? `${type} – ${entry.node.label}` : type,
		path: entry.path,
	};
}

/** A prop value as short readable text (`def` describes objects and lists). */
export function displayValue(value: PropValue | undefined, def?: PropDefinition): string {
	if (value === undefined || value === '') return '(empty)';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'number') return String(value);
	let text: string;
	if (Array.isArray(value)) {
		const noun = (def?.type === 'list' && def.itemLabel) || 'item';
		const items = def?.type === 'list' ? value.map((item) => itemSummary(def.fields, item)).filter(Boolean) : [];
		text = `${value.length} ${noun}${value.length === 1 ? '' : 's'}${items.length ? `: ${items.join(', ')}` : ''}`;
	} else if (typeof value === 'string') {
		text = value;
	} else if (def?.type === 'object') {
		text = Object.entries(def.fields)
			.filter(([name]) => (value as ObjectValue)[name] !== undefined)
			.map(([name, field]) => `${field.label}: ${displayValue((value as ObjectValue)[name], field)}`)
			.join('; ');
	} else if (isLinkValue(value)) {
		const target = value.type === 'page' ? `page ${value.page}` : value.url;
		return value.newTab ? `${target} (new tab)` : target;
	} else {
		text = isRichTextDoc(value) ? richTextToPlain(value) : JSON.stringify(value);
	}
	text = text.replace(/\s+/g, ' ').trim();
	if (!text) return '(empty)';
	return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

const isLinkValue = (value: object): value is LinkValue =>
	!Array.isArray(value) && 'type' in value && (value.type === 'page' || value.type === 'url');

const isRichTextDoc = (value: object): value is RichTextDoc =>
	!Array.isArray(value) && 'type' in value && value.type === 'doc' && 'content' in value;

/** A list item's first text, for the change list. */
function itemSummary(fields: Record<string, PropDefinition>, item: ObjectValue): string {
	for (const [name, field] of Object.entries(fields)) {
		const value = item[name];
		if (field.type === 'text' || field.type === 'textarea' || field.type === 'richtext') {
			const text = displayValue(value, field);
			if (text !== '(empty)') return text;
		}
	}
	return '';
}

/** Ids in `ids` whose order relative to the others differs between the two lists. */
function reordered(before: string[], after: string[]): Set<string> {
	const common = new Set(before.filter((id) => after.includes(id)));
	const a = before.filter((id) => common.has(id));
	const b = after.filter((id) => common.has(id));
	// Longest increasing subsequence of b's positions in a: those stayed; the rest moved.
	const positions = b.map((id) => a.indexOf(id));
	const tails: number[] = [];
	const tailIndex: number[] = [];
	const previous: number[] = new Array(positions.length).fill(-1);
	positions.forEach((p, i) => {
		let lo = 0;
		let hi = tails.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if ((tails[mid] as number) < p) lo = mid + 1;
			else hi = mid;
		}
		tails[lo] = p;
		tailIndex[lo] = i;
		previous[i] = lo > 0 ? (tailIndex[lo - 1] as number) : -1;
	});
	const stayed = new Set<string>();
	for (let i = tailIndex[tails.length - 1] ?? -1; i >= 0; i = previous[i] as number) stayed.add(b[i] as string);
	return new Set(b.filter((id) => !stayed.has(id)));
}

/** Differences from `before` to `after`. */
export function diffDocuments(
	before: TapestryDocument,
	after: TapestryDocument,
	manifest: ComponentManifest,
): DocumentDiff {
	const a = index(before, manifest);
	const b = index(after, manifest);
	const diff: DocumentDiff = { added: [], removed: [], moved: [], changed: [] };

	for (const [id, entry] of b) if (!a.has(id)) diff.added.push(ref(entry, manifest));
	for (const [id, entry] of a) if (!b.has(id)) diff.removed.push(ref(entry, manifest));

	// Moved: a different parent, or a different order among the siblings both versions share.
	const childIds = (doc: Map<string, Indexed>, parentId: string | null) =>
		[...doc.values()].filter((e) => e.parentId === parentId).map((e) => e.node.id);
	const parents = new Set([null, ...[...b.values()].map((e) => e.parentId)]);
	const movedIds = new Set<string>();
	for (const [id, entry] of b) {
		const old = a.get(id);
		if (old && (old.parentId !== entry.parentId || old.node.slot !== entry.node.slot)) movedIds.add(id);
	}
	for (const parentId of parents) {
		for (const id of reordered(childIds(a, parentId), childIds(b, parentId))) movedIds.add(id);
	}
	for (const id of movedIds) diff.moved.push(ref(b.get(id) as Indexed, manifest));

	for (const [id, entry] of b) {
		const old = a.get(id);
		if (!old) continue;
		const defs = manifest[entry.node.type]?.props ?? {};
		const props: PropChange[] = [];
		for (const [name, def] of Object.entries(defs)) {
			const x = old.node.props[name];
			const y = entry.node.props[name];
			if (JSON.stringify(x) === JSON.stringify(y)) continue;
			props.push({ prop: name, label: def.label, before: displayValue(x, def), after: displayValue(y, def) });
		}
		if ((old.node.label ?? '') !== (entry.node.label ?? '')) {
			props.push({
				prop: '$label',
				label: 'Name in page structure',
				before: old.node.label || '(none)',
				after: entry.node.label || '(none)',
			});
		}
		if (props.length > 0) diff.changed.push({ ...ref(entry, manifest), props });
	}
	return diff;
}

/** Total number of differences. */
export const diffSize = (diff: DocumentDiff) =>
	diff.added.length + diff.removed.length + diff.moved.length + diff.changed.length;
