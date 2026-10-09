import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { resolveCanvasDrop } from '../src/editor/canvas/geometry.js';
import { singleChangedNode, subtreeDocument } from '../src/editor/canvas/partial.js';
import { diffDocuments } from '../src/editor/diff.js';
import {
	createNode,
	duplicateNode,
	findNode,
	insertionTargetFor,
	insertNode,
	moveNode,
	nudgeTarget,
	setNodeLabel,
} from '../src/editor/tree.js';
import { renderDocument, splitSlots } from '../src/render.js';
import { sortByArea } from '../src/slots.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { validateDocument } from '../src/validate.js';

const split = defineComponent({
	type: 'split',
	label: 'Two columns',
	component: './Split.astro',
	slots: { left: { label: 'Left column' }, right: { label: 'Right column' } },
});
const panel = defineComponent({
	type: 'panel',
	label: 'Panel',
	component: './Panel.astro',
	acceptsChildren: true,
	slots: { aside: { label: 'Aside' } },
});
const text = defineComponent({
	type: 'text',
	label: 'Text',
	component: './Text.astro',
	props: { body: { type: 'text', label: 'Body' } },
});
const manifest = toManifest([split, panel, text]);

const t = (id: string, slot?: string): TapestryNode =>
	slot === undefined ? { id, type: 'text', props: {} } : { id, type: 'text', slot, props: {} };
const doc = (children: TapestryNode[]): TapestryDocument => ({
	version: 1,
	root: [{ id: 's', type: 'split', props: {}, children }],
});
const ids = (d: TapestryDocument | null, parent = 's') =>
	(findNode(d as TapestryDocument, parent)?.node.children ?? []).map((n) => `${n.id}:${n.slot ?? ''}`);

describe('validation', () => {
	it('keeps slots, groups children by slot order, and writes keys in canonical order', () => {
		const result = validateDocument(
			{
				version: 1,
				root: [
					{
						type: 'split',
						props: {},
						id: 's',
						children: [{ props: {}, slot: 'right', type: 'text', id: 'r1' }, t('l1', 'left'), t('r2', 'right')],
					},
				],
			},
			manifest,
		);
		expect(result.valid).toBe(true);
		expect(ids(result.document)).toEqual(['l1:left', 'r1:right', 'r2:right']);
		expect(JSON.stringify(result.document.root[0]?.children?.[1])).toBe(
			'{"id":"r1","type":"text","slot":"right","props":{}}',
		);
	});

	it('drops children without a slot (or with an unknown one) when there is no default area', () => {
		const result = validateDocument(doc([t('a'), t('b', 'middle'), t('c', 'left')]), manifest);
		expect(ids(result.document)).toEqual(['c:left']);
		expect(result.issues.map((i) => `${i.severity} ${i.path}`)).toEqual([
			'error root[0].children[0]',
			'error root[0].children[1].slot',
		]);
	});

	it('moves an unknown slot to the default area when there is one; ignores slots at the top level', () => {
		const result = validateDocument(
			{
				version: 1,
				root: [
					{ id: 'p', type: 'panel', props: {}, children: [t('x', 'aside'), t('y', 'nope'), t('z', 123 as never)] },
					t('top', 'left'),
				],
			},
			manifest,
		);
		expect(ids(result.document, 'p')).toEqual(['y:', 'z:', 'x:aside']);
		expect(result.document.root[1]).toEqual({ id: 'top', type: 'text', props: {} });
		expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
	});

	it('rejects prototype keys as slot names', () => {
		const result = validateDocument(doc([t('a', '__proto__'), t('b', 'constructor')]), manifest);
		expect(ids(result.document)).toEqual([]);
	});
});

describe('definitions', () => {
	it.each([
		['an empty slots object', {}],
		['a bad name', { 'left-col': { label: 'L' } }],
		['"default"', { default: { label: 'D' } }],
		['a missing label', { left: {} }],
	])('reject %s', (_, slots) => {
		expect(() => defineComponent({ type: 'x', label: 'X', component: './X.astro', slots: slots as never })).toThrow(
			TapestryDefinitionError,
		);
	});
});

describe('rendering', () => {
	it('wraps each named slot once; default children stay as they are', () => {
		const html = renderDocument({
			version: 1,
			root: [{ id: 'p', type: 'panel', props: {}, children: [t('a'), t('x', 'aside'), t('y', 'aside')] }],
		});
		expect(html).toBe(
			'<tapestry-root><tapestry-node id="p" type="panel" props="%7B%7D">' +
				'<tapestry-node id="a" type="text" props="%7B%7D"></tapestry-node>' +
				'<tapestry-slot name="aside"><tapestry-node id="x" type="text" props="%7B%7D"></tapestry-node>' +
				'<tapestry-node id="y" type="text" props="%7B%7D"></tapestry-node></tapestry-slot>' +
				'</tapestry-node></tapestry-root>',
		);
	});

	it('splitSlots takes the top-level wrappers apart', () => {
		expect(
			splitSlots('a<tapestry-slot name="left"><p>L</p></tapestry-slot>b<tapestry-slot name=right>R</tapestry-slot>'),
		).toEqual({ main: 'ab', slots: { left: '<p>L</p>', right: 'R' } });
	});

	it.each([
		['an unclosed wrapper', 'a<tapestry-slot name="left">L', 'a<tapestry-slot name="left">L'],
		[
			'a bad name',
			'<tapestry-slot name="__proto__">P</tapestry-slot>',
			'<tapestry-slot name="__proto__">P</tapestry-slot>',
		],
		['a stray closing tag', 'x</tapestry-slot>y', 'x</tapestry-slot>y'],
		['escaped text', '&lt;tapestry-slot name="left"&gt;', '&lt;tapestry-slot name="left"&gt;'],
	])('leaves %s in the default area', (_, html, main) => {
		const result = splitSlots(html);
		expect(result.main).toBe(main);
		expect(Object.keys(result.slots)).toEqual([]);
	});

	it('keeps nested wrappers inside their slot', () => {
		expect(
			splitSlots('<tapestry-slot name="a">1<tapestry-slot name="b">2</tapestry-slot>3</tapestry-slot>').slots.a,
		).toBe('1<tapestry-slot name="b">2</tapestry-slot>3');
	});
});

describe('tree operations', () => {
	const start = doc([t('l1', 'left'), t('r1', 'right'), t('r2', 'right')]);

	it('insert into a slot keeps children grouped', () => {
		const next = insertNode(start, manifest, t('n'), { parentId: 's', index: 3, slot: 'left' });
		expect(ids(next)).toEqual(['l1:left', 'n:left', 'r1:right', 'r2:right']);
		expect(insertNode(start, manifest, t('n'), { parentId: 's', index: 0 })).toBeNull(); // no default area
		expect(insertNode(start, manifest, t('n'), { parentId: 's', index: 0, slot: 'nope' })).toBeNull();
		expect(insertNode(start, manifest, t('n', 'left'), { parentId: null, index: 0 })?.root[0]).toEqual(t('n'));
	});

	it('moves between slots, and refuses moves that change nothing', () => {
		expect(ids(moveNode(start, manifest, 'r2', { parentId: 's', index: 0, slot: 'left' }))).toEqual([
			'r2:left',
			'l1:left',
			'r1:right',
		]);
		expect(moveNode(start, manifest, 'r1', { parentId: 's', index: 1, slot: 'right' })).toBeNull();
		// Grouping puts it back where it was.
		expect(moveNode(start, manifest, 'l1', { parentId: 's', index: 3, slot: 'left' })).toBeNull();
	});

	it('keyboard moves cross into the neighbouring slot', () => {
		const down = nudgeTarget(start, manifest, 'l1', 'down');
		expect(down).toEqual({ parentId: 's', index: 0, slot: 'right' });
		expect(ids(moveNode(start, manifest, 'l1', down as never))).toEqual(['l1:right', 'r1:right', 'r2:right']);
		const up = nudgeTarget(start, manifest, 'r1', 'up');
		expect(ids(moveNode(start, manifest, 'r1', up as never))).toEqual(['l1:left', 'r1:left', 'r2:right']);
		expect(ids(moveNode(start, manifest, 'r2', nudgeTarget(start, manifest, 'r2', 'up') as never))).toEqual([
			'l1:left',
			'r2:right',
			'r1:right',
		]);
	});

	it('indent goes into the previous sibling’s last area; outdent keeps the parent’s slot', () => {
		const page: TapestryDocument = { version: 1, root: [{ ...start.root[0] } as TapestryNode, t('after')] };
		expect(nudgeTarget(page, manifest, 'after', 'indent')).toEqual({ parentId: 's', index: 3, slot: 'right' });
		const nested = insertNode(
			start,
			manifest,
			{ id: 'p', type: 'panel', props: {}, children: [t('in')] },
			{
				parentId: 's',
				index: 1,
				slot: 'left',
			},
		) as TapestryDocument;
		expect(nudgeTarget(nested, manifest, 'in', 'outdent')).toEqual({ parentId: 's', index: 2, slot: 'left' });
	});

	it('duplicate, add and label keep slots and key order', () => {
		const dup = duplicateNode(start, manifest, 'r1');
		expect(ids(dup?.doc ?? null)).toEqual(['l1:left', 'r1:right', `${dup?.id}:right`, 'r2:right']);
		expect(insertionTargetFor(start, manifest, 's')).toEqual({ parentId: 's', index: 1, slot: 'left' });
		expect(insertionTargetFor(start, manifest, 'r1')).toEqual({ parentId: 's', index: 2, slot: 'right' });
		expect(createNode(manifest, 'split', new Set())?.children).toEqual([]);
		const labelled = setNodeLabel(start, 'r1', 'Main');
		expect(JSON.stringify(findNode(labelled as TapestryDocument, 'r1')?.node)).toBe(
			'{"id":"r1","type":"text","label":"Main","slot":"right","props":{}}',
		);
	});

	it('sortByArea is stable and leaves sorted lists alone', () => {
		const list = [t('a', 'left'), t('b', 'right')];
		expect(sortByArea(list, manifest.split)).toBe(list);
	});
});

describe('canvas', () => {
	const start = doc([t('l1', 'left'), t('r1', 'right')]);
	const rects: Record<string, { left: number; top: number; width: number; height: number }> = {
		s: { left: 0, top: 0, width: 400, height: 300 },
		l1: { left: 0, top: 0, width: 190, height: 50 },
		r1: { left: 210, top: 0, width: 190, height: 50 },
	};
	const areas = [
		{ slot: 'left', rect: { left: 0, top: 0, width: 190, height: 300 } },
		{ slot: 'right', rect: { left: 210, top: 0, width: 190, height: 300 } },
	];
	const drop = (x: number, y: number, hits: string[]) =>
		resolveCanvasDrop({
			doc: start,
			manifest,
			drag: { tapestry: 'new', componentType: 'text' },
			pointer: { x, y },
			hits,
			rectOf: (id) => rects[id] ?? null,
			areasOf: (id) => (id === 's' ? areas : []),
		});

	it('drops into the slot area under the pointer', () => {
		expect(drop(300, 200, ['s'])?.target).toEqual({ parentId: 's', index: 2, slot: 'right' });
		expect(drop(100, 200, ['s'])?.target).toEqual({ parentId: 's', index: 2, slot: 'left' });
	});

	it('drops before/after a child within its slot (stacked, not side by side)', () => {
		expect(drop(300, 10, ['r1', 's'])?.target).toEqual({ parentId: 's', index: 1, slot: 'right' });
		expect(drop(100, 40, ['l1', 's'])?.target).toEqual({ parentId: 's', index: 1, slot: 'left' });
	});

	it('a slot change is not a partial render; the one-node document drops the slot', () => {
		const moved = moveNode(start, manifest, 'l1', { parentId: 's', index: 1, slot: 'right' }) as TapestryDocument;
		expect(singleChangedNode(start, moved)).toBeNull();
		expect(subtreeDocument(start, 'r1')?.root[0]).toEqual(t('r1'));
	});
});

describe('change list', () => {
	it('reports a slot change as a move, with the slot in the path', () => {
		const before = doc([t('l1', 'left'), t('r1', 'right')]);
		const after = moveNode(before, manifest, 'l1', { parentId: 's', index: 1, slot: 'right' }) as TapestryDocument;
		const diff = diffDocuments(before, after, manifest);
		expect(diff.moved.map((m) => [m.id, m.path])).toEqual([['l1', 'Two columns › Right column']]);
	});
});
