import { describe, expect, it } from 'vitest';
import {
	allIds,
	createNode,
	duplicateNode,
	findNode,
	generateId,
	initialPropValue,
	insertionTargetFor,
	insertNode,
	isSelfOrDescendant,
	moveNode,
	nodeSummary,
	nudgeTarget,
	removeNode,
	updateProps,
} from '../src/editor/tree.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { validateDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const hero = (id: string, heading = id): TapestryNode => ({ id, type: 'hero', props: { heading } });
const section = (id: string, children: TapestryNode[] = []): TapestryNode => ({
	id,
	type: 'section',
	props: {},
	children,
});

/** root: [h1, s1[h2, s2[h3]], h4] */
function sample(): TapestryDocument {
	return { version: 1, root: [hero('h1'), section('s1', [hero('h2'), section('s2', [hero('h3')])]), hero('h4')] };
}

const shape = (doc: TapestryDocument | null): unknown => {
	const walk = (nodes: TapestryNode[]): unknown[] =>
		nodes.map((n) => (n.children ? { [n.id]: walk(n.children) } : n.id));
	return doc ? walk(doc.root) : null;
};

describe('findNode / allIds / isSelfOrDescendant', () => {
	it('locates nested nodes with parent, index and ancestors', () => {
		expect(findNode(sample(), 'h3')).toMatchObject({ parentId: 's2', index: 0, ancestors: ['s1', 's2'] });
		expect(findNode(sample(), 'h4')).toMatchObject({ parentId: null, index: 2, ancestors: [] });
		expect(findNode(sample(), 'nope')).toBeNull();
	});

	it('lists ids in document order', () => {
		expect(allIds(sample())).toEqual(['h1', 's1', 'h2', 's2', 'h3', 'h4']);
	});

	it('detects descendants', () => {
		expect(isSelfOrDescendant(sample(), 's1', 'h3')).toBe(true);
		expect(isSelfOrDescendant(sample(), 's1', 's1')).toBe(true);
		expect(isSelfOrDescendant(sample(), 's2', 'h2')).toBe(false);
	});
});

describe('insertNode', () => {
	it('inserts at root and inside containers, clamping the index', () => {
		expect(shape(insertNode(sample(), manifest, hero('x'), { parentId: null, index: 0 }))).toEqual([
			'x',
			'h1',
			{ s1: ['h2', { s2: ['h3'] }] },
			'h4',
		]);
		expect(shape(insertNode(sample(), manifest, hero('x'), { parentId: 's2', index: 99 }))).toEqual([
			'h1',
			{ s1: ['h2', { s2: ['h3', 'x'] }] },
			'h4',
		]);
	});

	it('refuses parents that do not accept children or do not exist', () => {
		expect(insertNode(sample(), manifest, hero('x'), { parentId: 'h1', index: 0 })).toBeNull();
		expect(insertNode(sample(), manifest, hero('x'), { parentId: 'ghost', index: 0 })).toBeNull();
	});

	it('does not mutate the input and shares untouched subtrees', () => {
		const doc = sample();
		const before = JSON.stringify(doc);
		const next = insertNode(doc, manifest, hero('x'), { parentId: 's2', index: 0 });
		expect(JSON.stringify(doc)).toBe(before);
		expect(next?.root[0]).toBe(doc.root[0]);
		expect(next?.root[2]).toBe(doc.root[2]);
	});
});

describe('removeNode', () => {
	it('removes a subtree', () => {
		expect(shape(removeNode(sample(), 's2'))).toEqual(['h1', { s1: ['h2'] }, 'h4']);
		expect(removeNode(sample(), 'ghost')).toBeNull();
	});
});

describe('moveNode', () => {
	it('moves within the same parent using pre-removal indexes', () => {
		expect(shape(moveNode(sample(), manifest, 'h1', { parentId: null, index: 3 }))).toEqual([
			{ s1: ['h2', { s2: ['h3'] }] },
			'h4',
			'h1',
		]);
		expect(shape(moveNode(sample(), manifest, 'h4', { parentId: null, index: 0 }))).toEqual([
			'h4',
			'h1',
			{ s1: ['h2', { s2: ['h3'] }] },
		]);
	});

	it('moves across parents', () => {
		expect(shape(moveNode(sample(), manifest, 'h3', { parentId: null, index: 0 }))).toEqual([
			'h3',
			'h1',
			{ s1: ['h2', { s2: [] }] },
			'h4',
		]);
	});

	it('returns null for no-op moves', () => {
		expect(moveNode(sample(), manifest, 'h1', { parentId: null, index: 0 })).toBeNull();
		expect(moveNode(sample(), manifest, 'h1', { parentId: null, index: 1 })).toBeNull();
	});

	it('refuses to move a node into itself or its descendants', () => {
		expect(moveNode(sample(), manifest, 's1', { parentId: 's1', index: 0 })).toBeNull();
		expect(moveNode(sample(), manifest, 's1', { parentId: 's2', index: 0 })).toBeNull();
	});

	it('refuses to move into a component that does not accept children', () => {
		expect(moveNode(sample(), manifest, 'h4', { parentId: 'h1', index: 0 })).toBeNull();
	});
});

describe('updateProps', () => {
	it('merges and removes props on nested nodes', () => {
		const doc = updateProps(sample(), 'h3', { heading: 'New', link: '/x' });
		expect(findNode(doc as TapestryDocument, 'h3')?.node.props).toEqual({ heading: 'New', link: '/x' });
		const removed = updateProps(doc as TapestryDocument, 'h3', { link: undefined });
		expect(findNode(removed as TapestryDocument, 'h3')?.node.props).toEqual({ heading: 'New' });
	});
});

describe('createNode / initialPropValue / generateId', () => {
	it('creates nodes that pass validation, with defaults and children arrays', () => {
		const taken = new Set<string>();
		const h = createNode(manifest, 'hero', taken) as TapestryNode;
		const s = createNode(manifest, 'section', taken) as TapestryNode;
		expect(h.props).toEqual({ heading: 'Heading', dark: false });
		expect(s.children).toEqual([]);
		const result = validateDocument({ version: 1, root: [{ ...s, children: [h] }] }, manifest);
		expect(result.valid).toBe(true);
	});

	it('returns null for unknown or inherited types', () => {
		expect(createNode(manifest, 'nope', new Set())).toBeNull();
		expect(createNode(manifest, 'constructor', new Set())).toBeNull();
	});

	it('picks valid values for required props without defaults', () => {
		expect(initialPropValue({ type: 'url', label: 'L', required: true })).toBe('#');
		expect(initialPropValue({ type: 'number', label: 'N', required: true, min: 3 })).toBe(3);
		expect(
			initialPropValue({ type: 'select', label: 'S', required: true, options: [{ value: 'a', label: 'A' }] }),
		).toBe('a');
		expect(initialPropValue({ type: 'text', label: 'Long label', required: true, maxLength: 4 })).toBe('Long');
		expect(initialPropValue({ type: 'text', label: 'Optional' })).toBeUndefined();
	});

	it('generates unique, valid ids', () => {
		const taken = new Set(['hero-aaaaaa']);
		const id = generateId('hero', taken);
		expect(id).toMatch(/^hero-[a-z0-9]{6}$/);
		expect(taken.has(id)).toBe(false);
	});
});

describe('duplicateNode', () => {
	it('copies a subtree after the original with fresh ids', () => {
		const result = duplicateNode(sample(), manifest, 's2');
		expect(result).not.toBeNull();
		const { doc, id } = result as { doc: TapestryDocument; id: string };
		const ids = allIds(doc);
		expect(new Set(ids).size).toBe(ids.length);
		expect(findNode(doc, id)).toMatchObject({ parentId: 's1', index: 2 });
		expect(findNode(doc, id)?.node.children?.[0]?.props).toEqual({ heading: 'h3' });
	});
});

describe('insertionTargetFor', () => {
	it('appends inside a selected container, after a selected leaf, else at the end', () => {
		expect(insertionTargetFor(sample(), manifest, 's2')).toEqual({ parentId: 's2', index: 1 });
		expect(insertionTargetFor(sample(), manifest, 'h2')).toEqual({ parentId: 's1', index: 1 });
		expect(insertionTargetFor(sample(), manifest, null)).toEqual({ parentId: null, index: 3 });
	});
});

describe('nudgeTarget', () => {
	const move = (id: string, dir: 'up' | 'down' | 'indent' | 'outdent') => {
		const doc = sample();
		const target = nudgeTarget(doc, manifest, id, dir);
		return target && shape(moveNode(doc, manifest, id, target));
	};

	it('moves up and down among siblings', () => {
		expect(move('h4', 'up')).toEqual(['h1', 'h4', { s1: ['h2', { s2: ['h3'] }] }]);
		expect(move('h1', 'down')).toEqual([{ s1: ['h2', { s2: ['h3'] }] }, 'h1', 'h4']);
		expect(move('h1', 'up')).toBeNull();
		expect(move('h4', 'down')).toBeNull();
	});

	it('indents into a previous container sibling and outdents after the parent', () => {
		expect(move('h4', 'indent')).toEqual(['h1', { s1: ['h2', { s2: ['h3'] }, 'h4'] }]);
		expect(move('h3', 'outdent')).toEqual(['h1', { s1: ['h2', { s2: [] }, 'h3'] }, 'h4']);
		expect(move('s1', 'indent')).toBeNull(); // previous sibling is a hero
		expect(move('h1', 'outdent')).toBeNull();
	});
});

describe('nodeSummary', () => {
	it('uses the first non-empty text prop, truncated', () => {
		expect(nodeSummary(manifest, hero('a', '  Hello   world '))).toBe('Hello world');
		expect(nodeSummary(manifest, hero('a', 'x'.repeat(60)), 10)).toBe(`${'x'.repeat(9)}…`);
		expect(nodeSummary(manifest, section('s'))).toBe('');
	});
});
