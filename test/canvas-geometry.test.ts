import { describe, expect, it } from 'vitest';
import { insertionIndex, isHorizontal, type Rect, resolveCanvasDrop } from '../src/editor/canvas/geometry.js';
import type { DragData } from '../src/editor/dnd.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { manifest } from './fixtures.js';

const r = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });

const hero = (id: string): TapestryNode => ({ id, type: 'hero', props: { heading: id } });
const section = (id: string, children: TapestryNode[] = []): TapestryNode => ({
	id,
	type: 'section',
	props: {},
	children,
});

/**
 * Layout (y grows downward):
 *   h1        0..100   (full width 0..1000)
 *   s1      100..400   container, children side by side:
 *     a     150..350   x 0..500
 *     b     150..350   x 500..1000
 *   h2      400..500
 */
const doc: TapestryDocument = { version: 1, root: [hero('h1'), section('s1', [hero('a'), hero('b')]), hero('h2')] };
const rects: Record<string, Rect> = {
	h1: r(0, 0, 1000, 100),
	s1: r(0, 100, 1000, 300),
	a: r(0, 150, 500, 200),
	b: r(500, 150, 500, 200),
	h2: r(0, 400, 1000, 100),
};
const rectOf = (id: string) => rects[id] ?? null;
const newHero: DragData = { tapestry: 'new', componentType: 'hero' };

function drop(x: number, y: number, hits: string[], drag: DragData = newHero) {
	return resolveCanvasDrop({ doc, manifest, drag, pointer: { x, y }, hits, rectOf });
}

describe('isHorizontal / insertionIndex', () => {
	it('detects side-by-side vs stacked siblings', () => {
		expect(isHorizontal([rects.a as Rect, rects.b as Rect])).toBe(true);
		expect(isHorizontal([rects.h1 as Rect, rects.s1 as Rect, rects.h2 as Rect])).toBe(false);
		expect(isHorizontal([rects.h1 as Rect])).toBe(false);
	});

	it('uses vertical midpoints for stacked children', () => {
		const stack = [r(0, 0, 100, 100), r(0, 100, 100, 100)];
		expect(insertionIndex(stack, { x: 90, y: 40 })).toBe(0);
		expect(insertionIndex(stack, { x: 10, y: 60 })).toBe(1);
		expect(insertionIndex(stack, { x: 10, y: 190 })).toBe(2);
	});

	it('uses reading order for side-by-side children', () => {
		const row = [rects.a as Rect, rects.b as Rect];
		expect(insertionIndex(row, { x: 100, y: 200 })).toBe(0);
		expect(insertionIndex(row, { x: 400, y: 200 })).toBe(1);
		expect(insertionIndex(row, { x: 900, y: 200 })).toBe(2);
		expect(insertionIndex(row, { x: 900, y: 120 })).toBe(0);
	});
});

describe('resolveCanvasDrop', () => {
	it('places before/after a stacked leaf by vertical half', () => {
		expect(drop(500, 20, ['h1'])?.target).toEqual({ parentId: null, index: 0 });
		expect(drop(500, 80, ['h1'])?.target).toEqual({ parentId: null, index: 1 });
		expect(drop(500, 80, ['h1'])?.indicator.line).toEqual({ x: 0, y: 100, length: 1000, orientation: 'horizontal' });
	});

	it('places left/right of a side-by-side leaf by horizontal half', () => {
		expect(drop(100, 250, ['a', 's1'])?.target).toEqual({ parentId: 's1', index: 0 });
		const after = drop(400, 250, ['a', 's1']);
		expect(after?.target).toEqual({ parentId: 's1', index: 1 });
		expect(after?.indicator.line.orientation).toBe('vertical');
	});

	it('drops inside a container when over its middle but not over a child', () => {
		const placement = drop(500, 380, ['s1']);
		expect(placement?.target).toEqual({ parentId: 's1', index: 2 });
		expect(placement?.indicator.outline).toEqual(rects.s1);
	});

	it('uses the container edge band to place before/after the container itself', () => {
		expect(drop(500, 105, ['s1'])?.target).toEqual({ parentId: null, index: 1 });
		expect(drop(500, 395, ['s1'])?.target).toEqual({ parentId: null, index: 2 });
	});

	it('appends to the page when nothing is under the pointer', () => {
		expect(drop(500, 900, [])?.target).toEqual({ parentId: null, index: 3 });
	});

	it('never drops a node into itself or its descendants', () => {
		const dragSection: DragData = { tapestry: 'node', id: 's1' };
		// Over child "a" of the dragged section: skip a and s1, fall back to the page end.
		expect(drop(100, 250, ['a', 's1'], dragSection)?.target).toEqual({ parentId: null, index: 3 });
	});

	it('does not offer "inside" for components that do not accept children', () => {
		expect(drop(500, 50, ['h1'])?.indicator.outline).toBeUndefined();
	});
});
