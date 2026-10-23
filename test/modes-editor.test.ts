import { describe, expect, it } from 'vitest';
import { defineComponent, toManifest } from '../src/define.js';
import { createEditorStore } from '../src/editor/store.js';
import { insertionTargetFor, setNodeModes } from '../src/editor/tree.js';
import { modeUsage, parseModes, parseTabs, tabsParam, withoutMode } from '../src/modes.js';
import { ROOT_ENTRY } from '../src/slots.js';
import { nodesText } from '../src/text.js';
import type { TapestryDocument } from '../src/types.js';
import { manifest } from './fixtures.js';

const T1 = 'tt_aaaaaaaaaaaaaaaa';
const modes = parseModes({ modes: [{ key: 'card', name: 'Card' }] });
const page = (): TapestryDocument => ({
	version: 1,
	template: T1,
	root: [
		{ id: 'a', type: 'hero', slot: 'main', props: { heading: 'Article' } },
		{ id: 's', type: 'hero', slot: 'main.teaser', props: { heading: 'Summary' } },
	],
});
const storeFor = (doc: TapestryDocument) =>
	createEditorStore(doc, manifest, Date.now, {
		templateAreas: new Map([[T1, [{ key: 'main', name: 'Main', modes: ['full', 'teaser'] }]]]),
		modes,
	});

describe('area tabs in the page editor', () => {
	it('give the root a slot per mode the area has', () => {
		const store = storeFor(page());
		expect(Object.keys(store.manifest[ROOT_ENTRY]?.slots ?? {})).toEqual(['main', 'main.teaser']);
	});

	it('switch only to modes the area has, and drop Full (the default)', () => {
		const store = storeFor(page());
		store.setTab('main', 'teaser');
		expect(store.tabs.value).toEqual({ main: 'teaser' });
		store.setTab('main', 'card');
		expect(store.tabs.value).toEqual({});
		store.setTab('main', 'teaser');
		store.setTab('main', 'full');
		expect(store.tabs.value).toEqual({});
	});

	it('clear a selection in the area’s other tab when switching', () => {
		const store = storeFor(page());
		store.select('a');
		store.setTab('main', 'teaser');
		expect(store.selectedId.value).toBeNull();
		store.select('s');
		store.setTab('main', 'teaser');
		expect(store.selectedId.value).toBe('s');
	});

	it('follow the selection: a component in a mode’s content shows its tab', () => {
		const store = storeFor(page());
		store.select('s');
		expect(store.tabs.value).toEqual({ main: 'teaser' });
		store.select('a');
		expect(store.tabs.value).toEqual({});
	});

	it('decide where a click-to-add goes with nothing selected', () => {
		const store = storeFor(page());
		expect(insertionTargetFor(store.doc.value, store.manifest, null, {}).slot).toBe('main');
		expect(insertionTargetFor(store.doc.value, store.manifest, null, { main: 'teaser' }).slot).toBe('main.teaser');
		// A tab the area doesn't have: its Full content.
		expect(insertionTargetFor(store.doc.value, store.manifest, null, { main: 'card' }).slot).toBe('main');
	});
});

describe('a template component’s modes in the editor', () => {
	const body: TapestryDocument = { version: 1, root: [{ id: 'x', type: 'hero', props: { heading: 'X' } }] };

	it('are set without storing the default', () => {
		const withTeaser = setNodeModes(body, 'x', ['full', 'teaser']);
		expect(withTeaser?.root[0]?.modes).toEqual(['full', 'teaser']);
		expect(JSON.stringify(withTeaser?.root[0])).toBe(
			'{"id":"x","type":"hero","modes":["full","teaser"],"props":{"heading":"X"}}',
		);
		expect(withTeaser && setNodeModes(withTeaser, 'x', ['full'])?.root[0]?.modes).toBeUndefined();
		expect(setNodeModes(body, 'x', ['full'])).toBeNull();
		expect(setNodeModes(body, 'missing', ['teaser'])).toBeNull();
	});
});

describe('mode usage and deleting a mode', () => {
	const a: TapestryDocument = {
		version: 1,
		root: [
			{ id: 'b', type: 'hero', props: { heading: 'B' } },
			{
				id: 'c',
				type: 'section',
				modes: ['full', 'card'],
				props: {},
				children: [{ id: 'd', type: 'hero', modes: ['card'], props: { heading: 'D' } }],
			},
		],
	};
	const b: TapestryDocument = {
		version: 1,
		root: [{ id: 'e', type: 'hero', modes: ['teaser'], props: { heading: 'E' } }],
	};

	it('count components and templates per mode', () => {
		const usage = modeUsage([a, b, null]);
		expect(usage.get('full')).toEqual({ components: 2, templates: 1 });
		expect(usage.get('card')).toEqual({ components: 2, templates: 1 });
		expect(usage.get('teaser')).toEqual({ components: 1, templates: 1 });
		expect(usage.get('other')).toBeUndefined();
	});

	it('take the mode off components; those left without one show in Full', () => {
		const out = withoutMode(a, 'card');
		expect(out.root[1]?.modes).toBeUndefined();
		expect(out.root[1]?.children?.[0]?.modes).toBeUndefined();
		expect(withoutMode(b, 'card')).toBe(b);
	});
});

describe('the canvas tabs parameter', () => {
	it('round-trips valid pairs and ignores the rest', () => {
		expect(parseTabs('main:teaser,side:card')).toEqual({ main: 'teaser', side: 'card' });
		expect(parseTabs('main:teaser:x,Bad:teaser,side:,:card,ok:Bad,x:<y>')).toEqual({});
		expect(parseTabs(null)).toEqual({});
		expect(parseTabs(Array.from({ length: 60 }, (_, i) => `a${i}:teaser`).join(','))).toHaveProperty('a49');
		expect(parseTabs(Array.from({ length: 60 }, (_, i) => `a${i}:teaser`).join(','))).not.toHaveProperty('a50');
		expect(tabsParam({ main: 'teaser', side: 'full' })).toBe('main:teaser');
	});
});

describe('a document’s plain text', () => {
	const m = {
		...manifest,
		...toManifest([
			defineComponent({
				type: 'article',
				label: 'Article',
				component: './A.astro',
				props: {
					title: { type: 'text', label: 'Title' },
					body: { type: 'richtext', label: 'Body' },
					note: { type: 'textarea', label: 'Note' },
					faq: { type: 'list', label: 'FAQ', fields: { answer: { type: 'textarea', label: 'Answer' } } },
				},
			}),
		]),
	};

	it('reads rich text and multi-line fields in page order, not short text', () => {
		const text = nodesText(
			[
				{
					id: 'x',
					type: 'article',
					props: {
						title: 'Not included',
						body: {
							type: 'doc',
							content: [
								{
									type: 'paragraph',
									content: [
										{ type: 'text', marks: [{ type: 'bold' }], text: 'Bold' },
										{ type: 'text', text: ' start.' },
									],
								},
								{ type: 'paragraph', content: [{ type: 'text', text: '<b>not markup</b>' }] },
							],
						},
						note: 'A\n\n note.',
						faq: [{ answer: 'An answer.' }],
					},
				},
			],
			m,
		);
		expect(text).toBe('Bold start. <b>not markup</b> A note. An answer.');
	});
});
