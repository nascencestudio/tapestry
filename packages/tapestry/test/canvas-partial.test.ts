import { describe, expect, it } from 'vitest';
import { singleChangedNode, subtreeDocument } from '../src/editor/canvas/partial.js';
import { moveNode, removeNode, updateProps } from '../src/editor/tree.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { manifest } from './fixtures.js';

const hero = (id: string, heading = id): TapestryNode => ({ id, type: 'hero', props: { heading } });
const section = (id: string, children: TapestryNode[] = []): TapestryNode => ({
	id,
	type: 'section',
	props: {},
	children,
});
const sample = (): TapestryDocument => ({
	version: 1,
	root: [hero('h1'), section('s1', [hero('h2'), section('s2', [hero('h3')])]), hero('h4')],
});

describe('singleChangedNode', () => {
	it('finds the one node whose props changed, at any depth', () => {
		const doc = sample();
		expect(singleChangedNode(doc, updateProps(doc, 'h3', { heading: 'new' }) as TapestryDocument)).toBe('h3');
		expect(singleChangedNode(doc, updateProps(doc, 'h1', { heading: 'new' }) as TapestryDocument)).toBe('h1');
	});

	it('is null when nothing changed', () => {
		expect(singleChangedNode(sample(), sample())).toBeNull();
	});

	it('is null for structural changes and for several changed nodes', () => {
		const doc = sample();
		expect(singleChangedNode(doc, removeNode(doc, 'h2') as TapestryDocument)).toBeNull();
		expect(
			singleChangedNode(doc, moveNode(doc, manifest, 'h4', { parentId: null, index: 0 }) as TapestryDocument),
		).toBeNull();
		const two = updateProps(updateProps(doc, 'h1', { heading: 'a' }) as TapestryDocument, 'h4', {
			heading: 'b',
		}) as TapestryDocument;
		expect(singleChangedNode(doc, two)).toBeNull();
		const retyped: TapestryDocument = {
			version: 1,
			root: [{ ...hero('h1'), type: 'section', children: [] }, ...doc.root.slice(1)],
		};
		expect(singleChangedNode(doc, retyped)).toBeNull();
	});

	it('compares props by value (a rebuilt but equal object is not a change)', () => {
		const doc = sample();
		const copy = JSON.parse(JSON.stringify(doc)) as TapestryDocument;
		expect(singleChangedNode(doc, copy)).toBeNull();
	});
});

describe('subtreeDocument', () => {
	it('wraps a node and its contents as a one-node document', () => {
		expect(subtreeDocument(sample(), 's2')).toEqual({ version: 1, root: [section('s2', [hero('h3')])] });
		expect(subtreeDocument(sample(), 'missing')).toBeNull();
	});
});

describe('cleanPlainText (inline editing of text props)', async () => {
	const { cleanPlainText } = await import('../src/editor/canvas/plain-text.js');
	it('keeps one line and the maximum length', () => {
		expect(cleanPlainText('Hello\nworld\r\n\tagain', 100)).toBe('Hello world again');
		expect(cleanPlainText('abcdef', 3)).toBe('abc');
	});
});
