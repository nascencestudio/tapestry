/**
 * Keyboard and clipboard commands on the page structure, shared by the layer
 * tree and the visual canvas so both can be used without a mouse:
 *
 * - ↑/↓ previous/next component (the tree skips collapsed contents; the canvas
 *   goes through every component in page order)
 * - →/← tree: expand or enter / collapse or go to the parent; canvas: first
 *   child / parent
 * - Alt+arrows move; Delete removes; Ctrl/⌘+D duplicates; Escape deselects
 * - Ctrl/⌘+C/X/V copy, cut, paste (as clipboard text, so it works between pages)
 *
 * No DOM access beyond the events: `focus` lets the caller move keyboard focus
 * to the newly selected component (the tree focuses its row).
 */
import type { EditorStore } from './store.js';
import {
	allIds,
	copyPayload,
	duplicateNode,
	findNode,
	insertNodes,
	isSelfOrDescendant,
	moveNode,
	nodesFromClipboard,
	nudgeTarget,
	removeNode,
} from './tree.js';

export interface StructureKeyOptions {
	announce: (message: string) => void;
	/** 'tree' honours collapsed containers and uses ←/→ to collapse/expand. */
	mode: 'tree' | 'canvas';
	/** Move keyboard focus to a component after a command selected it. */
	focus?: (id: string) => void;
}

const labelOf = (store: EditorStore, id: string) =>
	store.manifest[findNode(store.doc.peek(), id)?.node.type ?? '']?.label ?? 'Component';

/** Handle a structure key. Returns true (and prevents the default) if it was one. */
export function handleStructureKey(store: EditorStore, event: KeyboardEvent, options: StructureKeyOptions): boolean {
	const { announce, mode } = options;
	const focus = (id: string) => options.focus?.(id);
	const id = store.selectedId.peek();
	const current = store.doc.peek();
	const ids = mode === 'tree' ? store.visible.peek() : allIds(current);
	const mod = event.metaKey || event.ctrlKey;
	const done = () => {
		event.preventDefault();
		return true;
	};

	if (!event.altKey && !mod && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
		const index = id ? ids.indexOf(id) : -1;
		const next =
			event.key === 'ArrowDown'
				? ids[Math.min(index + 1, ids.length - 1)]
				: ids[index === -1 ? 0 : Math.max(index - 1, 0)];
		if (next) {
			store.select(next);
			focus(next);
			if (mode === 'canvas') announce(`${labelOf(store, next)} selected.`);
		}
		return done();
	}
	if (!id) return false;
	const location = findNode(current, id);
	if (!location) return false;
	const label = labelOf(store, id);

	if (!event.altKey && !mod && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
		const children = location.node.children ?? [];
		const isCollapsed = mode === 'tree' && store.collapsed.peek().has(id);
		if (event.key === 'ArrowRight') {
			if (children.length > 0 && isCollapsed) {
				store.setCollapsed(id, false);
				announce(`Expanded ${label}.`);
			} else if (children[0]) {
				store.select(children[0].id);
				focus(children[0].id);
				if (mode === 'canvas') announce(`${labelOf(store, children[0].id)} selected (inside ${label}).`);
			}
		} else if (mode === 'tree' && children.length > 0 && !isCollapsed) {
			store.setCollapsed(id, true);
			announce(`Collapsed ${label}.`);
		} else if (location.parentId) {
			store.select(location.parentId);
			focus(location.parentId);
			if (mode === 'canvas') announce(`${labelOf(store, location.parentId)} selected.`);
		}
		return done();
	}

	if (event.altKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
		const direction = ({ ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'outdent', ArrowRight: 'indent' } as const)[
			event.key as 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'
		];
		const target = nudgeTarget(current, store.manifest, id, direction);
		if (target && store.commit(moveNode(current, store.manifest, id, target))) {
			announce(
				`Moved ${label} ${direction === 'indent' ? 'into the previous container' : direction === 'outdent' ? 'out of its container' : direction}.`,
			);
			focus(id);
		} else {
			announce(`Can't move ${label} ${direction}.`);
		}
		return done();
	}
	if (event.key === 'Delete' || event.key === 'Backspace') {
		const fallback = fallbackAfterRemoving(store, id, ids);
		if (store.commit(removeNode(current, id), { select: fallback })) {
			announce(`Deleted ${label}.`);
			if (fallback) focus(fallback);
		}
		return done();
	}
	if (mod && !event.shiftKey && event.key.toLowerCase() === 'd') {
		const result = duplicateNode(current, store.manifest, id);
		if (result && store.commit(result.doc, { select: result.id })) {
			announce(`Duplicated ${label}.`);
			focus(result.id);
		}
		return done();
	}
	if (event.key === 'Escape') {
		store.select(null);
		return done();
	}
	return false;
}

/** The component to select after `id` (and its contents) is removed: the next one, else the previous. */
function fallbackAfterRemoving(store: EditorStore, id: string, ids: string[]): string | null {
	const doc = store.doc.peek();
	const index = ids.indexOf(id);
	return ids.slice(index + 1).find((other) => !isSelfOrDescendant(doc, id, other)) ?? ids[index - 1] ?? null;
}

/** Copy (or cut) the selected component, with its contents, as clipboard text. */
export function copySelection(
	store: EditorStore,
	event: ClipboardEvent,
	options: StructureKeyOptions & { cut?: boolean },
): boolean {
	const id = store.selectedId.peek();
	const location = id ? findNode(store.doc.peek(), id) : null;
	if (!location || !event.clipboardData) return false;
	event.preventDefault();
	event.clipboardData.setData('text/plain', copyPayload(location.node));
	const label = labelOf(store, location.node.id);
	if (options.cut) {
		const ids = options.mode === 'tree' ? store.visible.peek() : allIds(store.doc.peek());
		const fallback = fallbackAfterRemoving(store, location.node.id, ids);
		store.commit(removeNode(store.doc.peek(), location.node.id), { select: fallback });
		if (fallback) options.focus?.(fallback);
		options.announce(`Cut ${label}.`);
	} else {
		options.announce(`Copied ${label}.`);
	}
	return true;
}

/** Paste copied components after the selected one (or at the end of the page). */
export function pasteClipboard(store: EditorStore, event: ClipboardEvent, options: StructureKeyOptions): boolean {
	const text = event.clipboardData?.getData('text/plain') ?? '';
	const current = store.doc.peek();
	const nodes = nodesFromClipboard(text, store.manifest, new Set(allIds(current)));
	if (!nodes) {
		if (text.includes('tapestry/nodes'))
			options.announce("Nothing to paste: the copied components aren't available here.");
		return false;
	}
	event.preventDefault();
	const id = store.selectedId.peek();
	const location = id ? findNode(current, id) : null;
	const parentId = location ? location.parentId : null;
	const start = location ? location.index + 1 : current.root.length;
	const slot = location?.node.slot;
	const next = insertNodes(current, store.manifest, nodes, {
		parentId,
		index: start,
		...(slot === undefined ? {} : { slot }),
	});
	const first = nodes[0];
	if (next && first && store.commit(next, { select: first.id })) {
		options.focus?.(first.id);
		options.announce(
			`Pasted ${nodes.length === 1 ? (store.manifest[first.type]?.label ?? 'component') : `${nodes.length} components`}.`,
		);
	}
	return true;
}
