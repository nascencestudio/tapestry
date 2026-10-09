/**
 * Drag-and-drop glue between Pragmatic drag and drop and the editor store.
 * See docs/decisions/0007-drag-and-drop-library.md.
 *
 * Drag sources: library items (`new`) and layer rows (`node`).
 * Drop targets: layer rows (before / after / inside, via the list-item
 * hitbox) and "end zones" (append to a container or to the page).
 */
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter';
import { extractInstruction } from '@atlaskit/pragmatic-drag-and-drop-hitbox/list-item/extract-instruction';
import { signal } from '@preact/signals';
import { firstArea } from '../slots.js';
import { insertPattern } from './patterns-client.js';
import type { EditorStore } from './store.js';
import { allIds, createNode, findNode, insertNode, moveNode, type Target } from './tree.js';

export type DragData =
	| { tapestry: 'new'; componentType: string }
	| { tapestry: 'node'; id: string }
	/** A saved pattern from the library (inserted as a fresh copy). */
	| { tapestry: 'pattern'; id: string; name: string };

export type DropData =
	| { tapestry: 'row'; id: string }
	/** Append to a container's area (`slot` absent: its default area) or to the page. */
	| { tapestry: 'end'; parentId: string | null; slot?: string };

export function isDragData(data: Record<string | symbol, unknown>): data is DragData {
	return data.tapestry === 'new' || data.tapestry === 'node' || data.tapestry === 'pattern';
}

function isDropData(data: Record<string | symbol, unknown>): data is DropData {
	return data.tapestry === 'row' || data.tapestry === 'end';
}

/** Which row is currently hovered during a drag, and what dropping would do. Drives the visual indicator. */
export const dropIndicator = signal<{ id: string; operation: 'reorder-before' | 'reorder-after' | 'combine' } | null>(
	null,
);
/** Id of the end zone (`root` or a container id) currently hovered. */
export const activeEndZone = signal<string | null>(null);
/** True while any Tapestry drag is in progress (shows end zones). */
export const isDragging = signal(false);
/**
 * What is being dragged right now, from the library/layers (via Pragmatic) or
 * from the canvas's own drag handle. The canvas reads this on native
 * dragover/drop inside its iframe, where Pragmatic doesn't reach.
 */
export const activeDrag = signal<DragData | null>(null);

const withSlot = (target: Target, slot: string | undefined): Target =>
	slot === undefined ? target : { ...target, slot };

/** Translate a drop target's data into a tree position. */
export function resolveTarget(store: EditorStore, data: Record<string | symbol, unknown>): Target | null {
	if (!isDropData(data)) return null;
	const doc = store.doc.peek();
	if (data.tapestry === 'end') {
		const children = data.parentId === null ? doc.root : findNode(doc, data.parentId)?.node.children;
		if (!children) return null;
		// Grouping by slot puts it at the end of its slot.
		return data.slot === undefined
			? { parentId: data.parentId, index: children.length }
			: { parentId: data.parentId, index: children.length, slot: data.slot };
	}
	const instruction = extractInstruction(data);
	const location = findNode(doc, data.id);
	if (!instruction || instruction.blocked || !location) return null;
	switch (instruction.operation) {
		case 'reorder-before':
			return withSlot({ parentId: location.parentId, index: location.index }, location.node.slot);
		case 'reorder-after':
			return withSlot({ parentId: location.parentId, index: location.index + 1 }, location.node.slot);
		case 'combine':
			// Into the container's first area (its default one, if it has one), at the end.
			return withSlot(
				{ parentId: location.node.id, index: location.node.children?.length ?? 0 },
				firstArea(store.manifest[location.node.type]),
			);
	}
}

/**
 * Apply a drop: insert a new component or move an existing node to `target`,
 * select it, and announce the change. Returns whether anything changed.
 * Shared by the layer tree (Pragmatic) and the visual canvas (native events).
 */
export function applyDrop(
	store: EditorStore,
	drag: DragData,
	target: Target,
	announce: (message: string) => void,
): boolean {
	const doc = store.doc.peek();
	const manifest = store.manifest;
	if (drag.tapestry === 'pattern') {
		// Fetched, then inserted (the pattern's components aren't in the library list).
		void insertPattern(store, drag, target, announce);
		return true;
	}
	if (drag.tapestry === 'new') {
		const node = createNode(manifest, drag.componentType, new Set(allIds(doc)));
		if (node && store.commit(insertNode(doc, manifest, node, target), { select: node.id })) {
			announce(`Added ${manifest[node.type]?.label ?? node.type}.`);
			return true;
		}
		return false;
	}
	if (store.commit(moveNode(doc, manifest, drag.id, target), { select: drag.id })) {
		const type = findNode(doc, drag.id)?.node.type ?? '';
		announce(`Moved ${manifest[type]?.label ?? type}.`);
		return true;
	}
	return false;
}

/**
 * Listen for drops anywhere in the editor and apply them to the store.
 * Returns a cleanup function.
 */
export function monitorDrops(store: EditorStore, announce: (message: string) => void): () => void {
	return monitorForElements({
		canMonitor: ({ source }) => isDragData(source.data),
		onDragStart: ({ source }) => {
			isDragging.value = true;
			activeDrag.value = isDragData(source.data) ? source.data : null;
		},
		onDrop: ({ source, location }) => {
			isDragging.value = false;
			activeDrag.value = null;
			dropIndicator.value = null;
			activeEndZone.value = null;
			const dropTarget = location.current.dropTargets[0];
			if (!dropTarget || !isDragData(source.data)) return;
			const target = resolveTarget(store, dropTarget.data);
			if (!target) return;
			applyDrop(store, source.data, target, announce);
		},
	});
}
