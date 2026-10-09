import { describe, expect, it } from 'vitest';
import { defineComponent, toManifest } from '../src/define.js';
import { allIds, freshCopies, insertNodes } from '../src/editor/tree.js';
import {
	cleanPatternName,
	describePattern,
	newPatternId,
	PATTERN_ID,
	PATTERN_LIMITS,
	parseStoredPattern,
	patternFromInput,
	summarizePattern,
} from '../src/patterns.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';

const manifest = toManifest([
	defineComponent({ type: 'section', label: 'Section', component: './S.astro', acceptsChildren: true }),
	defineComponent({
		type: 'heading',
		label: 'Heading',
		component: './H.astro',
		props: { text: { type: 'text', label: 'Text', required: true } },
	}),
]);

const section: TapestryNode = {
	id: 'section-1',
	type: 'section',
	label: 'Pricing',
	props: {},
	children: [
		{ id: 'h1', type: 'heading', props: { text: 'Plans' } },
		{ id: 'h2', type: 'heading', props: { text: 'FAQ' } },
	],
};
const author = { id: 'u1', name: 'Ada' };
const now = new Date('2026-10-07T12:00:00Z');

describe('patternFromInput', () => {
	it('builds a validated pattern', () => {
		const result = patternFromInput(
			{ name: '  Pricing\n block ', nodes: [section] },
			manifest,
			author,
			now,
			'pt_aaaaaaaaaaaaaaaa',
		);
		expect(result).toEqual({
			pattern: {
				id: 'pt_aaaaaaaaaaaaaaaa',
				name: 'Pricing block',
				nodes: [section],
				createdAt: '2026-10-07T12:00:00.000Z',
				createdBy: 'u1',
				createdByName: 'Ada',
			},
		});
	});

	it.each([
		['no object', null, 400],
		['no name', { name: ' ', nodes: [section] }, 400],
		['a non-text name', { name: 42, nodes: [section] }, 400],
		['no valid components', { name: 'X', nodes: [{ id: 'x', type: 'unknown', props: {} }] }, 400],
		['nodes not a list', { name: 'X', nodes: 'nope' }, 400],
		[
			'too much content',
			{
				name: 'X',
				nodes: Array.from({ length: 400 }, (_, i) => ({
					id: `h${i}`,
					type: 'heading',
					props: { text: 'x'.repeat(400) },
				})),
			},
			413,
		],
	])('refuses %s', (_, input, status) => {
		const result = patternFromInput(input, manifest, author, now);
		expect('error' in result && result.status).toBe(status);
	});

	it('cleans components like stored content (unknown props and components dropped, slot removed)', () => {
		const result = patternFromInput(
			{
				name: 'X',
				nodes: [
					{ id: 'h', type: 'heading', slot: 'left', props: { text: 'Hi', onclick: 'alert(1)' } },
					{ id: 'bad', type: 'script', props: {} },
				],
			},
			manifest,
			author,
			now,
		);
		expect('pattern' in result && result.pattern.nodes).toEqual([{ id: 'h', type: 'heading', props: { text: 'Hi' } }]);
	});
});

describe('stored patterns', () => {
	it('parse back, cleaned against the current manifest', () => {
		const stored = {
			id: 'pt_aaaaaaaaaaaaaaaa',
			name: 'P',
			nodes: [section, { id: 'gone', type: 'removed', props: {} }],
			createdAt: 'x',
			createdBy: 'u1',
			createdByName: 'Ada',
		};
		expect(parseStoredPattern(stored, manifest)?.nodes).toEqual([section]);
		expect(parseStoredPattern({ ...stored, id: '../etc' }, manifest)).toBeNull();
		expect(parseStoredPattern({ ...stored, name: '' }, manifest)).toBeNull();
		expect(parseStoredPattern('nope', manifest)).toBeNull();
	});

	it('summaries say who can delete', () => {
		const pattern = parseStoredPattern(
			{ id: 'pt_aaaaaaaaaaaaaaaa', name: 'P', nodes: [section], createdAt: '', createdBy: 'u1', createdByName: 'Ada' },
			manifest,
		);
		if (!pattern) throw new Error('unparsed');
		expect(summarizePattern(pattern, manifest, { id: 'u1', isAdmin: false }).canDelete).toBe(true);
		expect(summarizePattern(pattern, manifest, { id: 'u2', isAdmin: false }).canDelete).toBe(false);
		expect(summarizePattern(pattern, manifest, { id: 'u2', isAdmin: true }).canDelete).toBe(true);
		expect(summarizePattern({ ...pattern, createdBy: null }, manifest, { id: null, isAdmin: false }).canDelete).toBe(
			false,
		);
	});

	it('ids, names and descriptions', () => {
		expect(newPatternId()).toMatch(PATTERN_ID);
		expect(newPatternId(() => new Uint8Array(16))).toBe('pt_0000000000000000');
		expect(cleanPatternName('a\u0000b\u202E c')).toBe('a b c');
		expect(cleanPatternName('x'.repeat(100))).toHaveLength(PATTERN_LIMITS.nameMaxLength);
		expect(describePattern([section], manifest)).toBe('Section with 2 components inside');
		expect(describePattern([section.children?.[0] as TapestryNode], manifest)).toBe('Heading');
		expect(describePattern([section, section], manifest)).toBe('2 components');
	});
});

describe('inserting copies', () => {
	const doc: TapestryDocument = { version: 1, root: [section] };

	it('gives every node a fresh id and inserts them in order', () => {
		const copies = freshCopies(
			[section, { id: 'h9', type: 'heading', props: { text: 'More' } }],
			manifest,
			new Set(allIds(doc)),
		);
		if (!copies) throw new Error('no copies');
		const ids = new Set(allIds({ version: 1, root: copies }));
		for (const id of allIds(doc)) expect(ids.has(id)).toBe(false);
		expect(copies[0]?.label).toBe('Pricing');
		const next = insertNodes(doc, manifest, copies, { parentId: null, index: 1 });
		expect(next?.root.map((n) => n.type)).toEqual(['section', 'section', 'heading']);
		expect(new Set(allIds(next as TapestryDocument)).size).toBe(allIds(next as TapestryDocument).length);
	});

	it('nothing valid → null; a place that can’t hold them → null', () => {
		expect(freshCopies([{ id: 'x', type: 'unknown', props: {} }], manifest, new Set())).toBeNull();
		const copies = freshCopies([section], manifest, new Set()) as TapestryNode[];
		expect(insertNodes(doc, manifest, copies, { parentId: 'h1', index: 0 })).toBeNull();
	});
});
