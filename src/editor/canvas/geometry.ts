/**
 * Pure geometry for dropping onto the visual canvas: given what's under the
 * pointer, decide where a dragged component should go and where to draw the
 * drop indicator. No DOM access; the canvas controller supplies rectangles.
 */
import type { ComponentManifest, TapestryDocument, TapestryNode } from '../../types.js';
import type { DragData } from '../dnd.js';
import { acceptsChildren, findNode, isSelfOrDescendant, type Target } from '../tree.js';

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/** A line to draw (in the same coordinates as the rects), plus an optional container outline. */
export interface Indicator {
	line: { x: number; y: number; length: number; orientation: 'horizontal' | 'vertical' };
	outline?: Rect;
}

export interface Placement {
	target: Target;
	indicator: Indicator;
}

export interface DropQuery {
	doc: TapestryDocument;
	manifest: ComponentManifest;
	drag: DragData;
	pointer: Point;
	/** Node ids under the pointer, innermost first. */
	hits: string[];
	/** Rectangle of a node, or null if it isn't rendered. */
	rectOf: (id: string) => Rect | null;
	/** For components with named slots: the area each slot occupies (`slot` undefined: the default area). */
	areasOf?: (id: string) => Array<{ slot: string | undefined; rect: Rect }>;
}

const contains = (r: Rect, p: Point) => p.x >= r.left && p.x <= right(r) && p.y >= r.top && p.y <= bottom(r);

const withSlot = (target: Target, slot: string | undefined): Target =>
	slot === undefined ? target : { ...target, slot };

const right = (r: Rect) => r.left + r.width;
const bottom = (r: Rect) => r.top + r.height;

function overlapsVertically(a: Rect, b: Rect): boolean {
	return a.top < bottom(b) && b.top < bottom(a);
}

/** True if siblings are laid out side by side (e.g. grid columns) rather than stacked. */
export function isHorizontal(rects: Rect[]): boolean {
	for (let i = 1; i < rects.length; i++) {
		const a = rects[i - 1] as Rect;
		const b = rects[i] as Rect;
		if (overlapsVertically(a, b) && Math.abs(a.left - b.left) > 1) return true;
	}
	return false;
}

/**
 * Index among `rects` (children in document order) at which a pointer would
 * insert. Stacked children: before the first child whose vertical midpoint is
 * below the pointer. Side-by-side children (columns, wrapped rows): reading
 * order: before the first child in a later row, or in the same row to the
 * right of the pointer's horizontal midpoint.
 */
export function insertionIndex(rects: Rect[], p: Point): number {
	const index = isHorizontal(rects)
		? rects.findIndex((r) => p.y < r.top || (p.y <= bottom(r) && p.x < r.left + r.width / 2))
		: rects.findIndex((r) => p.y < r.top + r.height / 2);
	return index === -1 ? rects.length : index;
}

function lineAt(rect: Rect, edge: 'top' | 'bottom' | 'left' | 'right'): Indicator['line'] {
	switch (edge) {
		case 'top':
			return { x: rect.left, y: rect.top, length: rect.width, orientation: 'horizontal' };
		case 'bottom':
			return { x: rect.left, y: bottom(rect), length: rect.width, orientation: 'horizontal' };
		case 'left':
			return { x: rect.left, y: rect.top, length: rect.height, orientation: 'vertical' };
		case 'right':
			return { x: right(rect), y: rect.top, length: rect.height, orientation: 'vertical' };
	}
}

/** Line marking insertion at `index` among children laid out as `rects`, inside `container`. */
function lineForIndex(rects: Rect[], index: number, container: Rect): Indicator['line'] {
	if (rects.length === 0) {
		return {
			x: container.left,
			y: container.top + container.height / 2,
			length: container.width,
			orientation: 'horizontal',
		};
	}
	const horizontal = isHorizontal(rects);
	const before = rects[index];
	if (before) return lineAt(before, horizontal ? 'left' : 'top');
	return lineAt(rects[rects.length - 1] as Rect, horizontal ? 'right' : 'bottom');
}

function isAllowed(query: DropQuery, target: Target): boolean {
	if (!acceptsChildren(query.doc, query.manifest, target.parentId, target.slot)) return false;
	if (query.drag.tapestry === 'node' && target.parentId !== null) {
		return !isSelfOrDescendant(query.doc, query.drag.id, target.parentId);
	}
	return true;
}

function childRects(query: DropQuery, ids: string[]): Rect[] {
	return ids.map((id) => query.rectOf(id)).filter((r): r is Rect => r !== null);
}

/** Children that are rendered, with their rectangles. */
function renderedChildren(query: DropQuery, nodes: TapestryNode[]): Array<{ node: TapestryNode; rect: Rect }> {
	return nodes.flatMap((node) => {
		const rect = query.rectOf(node.id);
		return rect ? [{ node, rect }] : [];
	});
}

/**
 * Decide where a drop at `pointer` goes.
 *
 * Walks from the innermost node under the pointer outward:
 * - Over the middle of a container: insert inside it, at the position among
 *   its children nearest the pointer.
 * - Otherwise: before or after the node (left/right if its siblings sit side
 *   by side, above/below if they stack).
 * Nothing under the pointer: append to the end of the page.
 * Returns null if no allowed position exists.
 */
export function resolveCanvasDrop(query: DropQuery): Placement | null {
	const { doc, manifest, pointer } = query;
	for (const id of query.hits) {
		if (query.drag.tapestry === 'node' && isSelfOrDescendant(doc, query.drag.id, id)) continue;
		const location = findNode(doc, id);
		const rect = query.rectOf(id);
		if (!location || !rect) continue;

		const entry = manifest[location.node.type];
		const edge = Math.min(12, rect.height * 0.2);
		const inMiddle = pointer.y > rect.top + edge && pointer.y < bottom(rect) - edge;
		if (entry?.slots && inMiddle) {
			// Named slots: the area under the pointer, at the position among its children.
			const area = (query.areasOf?.(id) ?? []).find((a) => contains(a.rect, pointer));
			if (area) {
				const children = location.node.children ?? [];
				const rendered = renderedChildren(
					query,
					children.filter((c) => c.slot === area.slot),
				);
				const rects = rendered.map((r) => r.rect);
				const at = insertionIndex(rects, pointer);
				const before = rendered[at]?.node;
				// At the end of the area: grouping by slot moves it there from the end of the list.
				const target = withSlot(
					{ parentId: id, index: before ? children.indexOf(before) : children.length },
					area.slot,
				);
				if (isAllowed(query, target)) {
					return { target, indicator: { line: lineForIndex(rects, at, area.rect), outline: area.rect } };
				}
			}
		} else if (entry?.acceptsChildren) {
			if (inMiddle) {
				const ids = (location.node.children ?? []).map((c) => c.id);
				const rects = childRects(query, ids);
				const target = { parentId: id, index: insertionIndex(rects, pointer) };
				if (isAllowed(query, target)) {
					return { target, indicator: { line: lineForIndex(rects, target.index, rect), outline: rect } };
				}
			}
		}

		const siblings = location.parentId === null ? doc.root : (findNode(doc, location.parentId)?.node.children ?? []);
		// Only siblings in the same slot: two slots side by side don't make a column of stacked items horizontal.
		const horizontal = isHorizontal(
			childRects(
				query,
				siblings.filter((s) => s.slot === location.node.slot).map((s) => s.id),
			),
		);
		const after = horizontal ? pointer.x > rect.left + rect.width / 2 : pointer.y > rect.top + rect.height / 2;
		const target = withSlot(
			{ parentId: location.parentId, index: location.index + (after ? 1 : 0) },
			location.node.slot,
		);
		if (isAllowed(query, target)) {
			const edge = horizontal ? (after ? 'right' : 'left') : after ? 'bottom' : 'top';
			return { target, indicator: { line: lineAt(rect, edge) } };
		}
	}

	const rootRects = childRects(
		query,
		doc.root.map((n) => n.id),
	);
	const last = rootRects[rootRects.length - 1];
	return {
		target: { parentId: null, index: doc.root.length },
		indicator: {
			line: last
				? lineAt(last, 'bottom')
				: { x: pointer.x - 100, y: pointer.y, length: 200, orientation: 'horizontal' },
		},
	};
}
