import { describe, expect, it } from 'vitest';
import { diffDocuments, diffSize, displayValue } from '../src/editor/diff.js';
import { moveNode, removeNode, setNodeLabel, updateProps } from '../src/editor/tree.js';
import { richTextFromPlain } from '../src/richtext.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { manifest } from './fixtures.js';

const hero = (id: string, heading = id): TapestryNode => ({ id, type: 'hero', props: { heading } });
const section = (id: string, children: TapestryNode[] = []): TapestryNode => ({
	id,
	type: 'section',
	props: {},
	children,
});
/** root: [h1, s1[h2, s2[h3]], h4] */
const sample = (): TapestryDocument => ({
	version: 1,
	root: [hero('h1'), section('s1', [hero('h2'), section('s2', [hero('h3')])]), hero('h4')],
});

describe('diffDocuments', () => {
	it('finds nothing between identical versions', () => {
		expect(diffSize(diffDocuments(sample(), sample(), manifest))).toBe(0);
	});

	it('reports changed settings with readable before/after values and where the component is', () => {
		const after = updateProps(sample(), 'h3', { heading: 'New heading', dark: true }) as TapestryDocument;
		const diff = diffDocuments(sample(), after, manifest);
		expect(diff.changed).toEqual([
			{
				id: 'h3',
				type: 'hero',
				label: 'Hero',
				path: 'Section › Section',
				props: [
					{ prop: 'heading', label: 'Heading', before: 'h3', after: 'New heading' },
					{ prop: 'dark', label: 'Dark', before: '(empty)', after: 'Yes' },
				],
			},
		]);
		expect(diff.added).toEqual([]);
		expect(diff.moved).toEqual([]);
	});

	it('reports added and removed components', () => {
		const without = removeNode(sample(), 's2') as TapestryDocument;
		const after: TapestryDocument = { ...without, root: [...without.root, hero('h9')] };
		const diff = diffDocuments(sample(), after, manifest);
		expect(diff.added.map((n) => n.id)).toEqual(['h9']);
		expect(diff.removed.map((n) => n.id).sort()).toEqual(['h3', 's2']);
	});

	it('reports moves (new parent or new order), not the siblings that merely shifted', () => {
		const into = moveNode(sample(), manifest, 'h4', { parentId: 's2', index: 0 }) as TapestryDocument;
		expect(diffDocuments(sample(), into, manifest).moved.map((n) => n.id)).toEqual(['h4']);
		const reorder = moveNode(sample(), manifest, 'h4', { parentId: null, index: 0 }) as TapestryDocument;
		expect(diffDocuments(sample(), reorder, manifest).moved.map((n) => n.id)).toEqual(['h4']);
	});

	it('includes name changes and uses names in labels', () => {
		const after = setNodeLabel(sample(), 'h1', 'Pricing') as TapestryDocument;
		const diff = diffDocuments(sample(), after, manifest);
		expect(diff.changed[0]).toMatchObject({
			label: 'Hero – Pricing',
			props: [{ prop: '$label', before: '(none)', after: 'Pricing' }],
		});
	});
});

describe('displayValue', () => {
	it('shortens and flattens text, including rich text', () => {
		expect(displayValue('a\n  b')).toBe('a b');
		expect(displayValue('x'.repeat(300))).toHaveLength(120);
		expect(displayValue(richTextFromPlain('Hello world'))).toBe('Hello world');
		expect(displayValue(false)).toBe('No');
		expect(displayValue(undefined)).toBe('(empty)');
	});
});
