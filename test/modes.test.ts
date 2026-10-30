import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import {
	BUILT_IN_MODES,
	cleanModeName,
	cleanNodeModes,
	MAX_MODES,
	modeKeyFor,
	modeSlot,
	parseModeSlot,
	parseModes,
	shownIn,
	storedModes,
} from '../src/modes.js';
import { ROOT_ENTRY, withRootAreas } from '../src/slots.js';
import { AREA_TYPE, assignAreas, hasModeContent, mergeTemplate, templateAreas } from '../src/templates.js';
import type { TapestryDocument, TapestryNode } from '../src/types.js';
import { validateDocument, validatePropValue } from '../src/validate.js';
import { manifest as fixtures } from './fixtures.js';

const T1 = 'tt_aaaaaaaaaaaaaaaa';
const manifest = {
	...fixtures,
	...toManifest([
		defineComponent({
			type: AREA_TYPE,
			label: 'Content area',
			component: './Area.astro',
			acceptsChildren: true,
			props: { name: { type: 'text', label: 'Name', required: true } },
		}),
	]),
};
const hero = (id: string, extra: Partial<TapestryNode> = {}): TapestryNode => ({
	id,
	type: 'hero',
	props: { heading: id },
	...extra,
});
const area = (id: string, name: string, modes?: string[]): TapestryNode => ({
	id,
	type: AREA_TYPE,
	...(modes ? { modes } : {}),
	props: { name },
});
const doc = (root: TapestryNode[], template?: string): TapestryDocument => ({
	version: 1,
	...(template ? { template } : {}),
	root,
});
const ids = (d: TapestryDocument): string[] => {
	const out: string[] = [];
	const walk = (nodes: readonly TapestryNode[]) => {
		for (const n of nodes) {
			out.push(n.id);
			if (n.children) walk(n.children);
		}
	};
	walk(d.root);
	return out;
};

describe('the site’s display modes', () => {
	it('always start with Full and Teaser, then the added ones', () => {
		expect(parseModes(null)).toEqual(BUILT_IN_MODES);
		expect(parseModes({ modes: [{ key: 'card', name: 'Card' }] }).map((m) => m.key)).toEqual([
			'full',
			'teaser',
			'card',
		]);
	});

	it('drop invalid, duplicate and built-in entries, and stop at the limit', () => {
		const many = Array.from({ length: 30 }, (_, i) => ({ key: `m${i}`, name: `M ${i}` }));
		const modes = parseModes({
			modes: [
				{ key: 'Full', name: 'Bad key' },
				{ key: 'teaser', name: 'Renamed teaser' },
				{ key: 'card', name: '   ' },
				{ key: 'card', name: 'Card' },
				{ key: 'card', name: 'Card again' },
				'nonsense',
				...many,
			],
		});
		expect(modes).toHaveLength(MAX_MODES);
		expect(modes[1]).toEqual({ key: 'teaser', name: 'Teaser' });
		expect(modes.filter((m) => m.key === 'card')).toEqual([{ key: 'card', name: 'Card' }]);
	});

	it('store only the added modes', () => {
		expect(storedModes(parseModes({ modes: [{ key: 'card', name: 'Card' }] }))).toEqual({
			version: 1,
			modes: [{ key: 'card', name: 'Card' }],
		});
	});

	it('get keys from their names that never collide', () => {
		expect(modeKeyFor('Search result', new Set())).toBe('search-result');
		expect(modeKeyFor('Teaser', new Set(['full', 'teaser']))).toBe('teaser-2');
		expect(modeKeyFor('2 columns', new Set())).toBe('mode-2-columns');
		expect(modeKeyFor('Ünïcodé', new Set())).toBe('unicode');
		expect(modeKeyFor('!!!', new Set())).toBe('mode');
	});

	it('clean names to one short line without control or direction characters', () => {
		expect(cleanModeName('  Big\n\tcard ‮ ')).toBe('Big card');
		expect(cleanModeName('x'.repeat(100))).toHaveLength(40);
		expect(cleanModeName(42)).toBe('');
	});
});

describe('a node’s modes', () => {
	it('are valid unique keys; Full alone is the default and not stored', () => {
		expect(cleanNodeModes(['full'])).toBeUndefined();
		expect(cleanNodeModes([])).toBeUndefined();
		expect(cleanNodeModes('full')).toBeUndefined();
		expect(cleanNodeModes(['teaser', 'Teaser', 'teaser', 7, 'full'])).toEqual(['teaser', 'full']);
		expect(shownIn({}, 'full')).toBe(true);
		expect(shownIn({}, 'teaser')).toBe(false);
	});

	it('are kept by the validator in canonical key order', () => {
		const result = validateDocument(
			{ version: 1, root: [{ props: { heading: 'x' }, modes: ['teaser', 'bad key'], type: 'hero', id: 'a' }] },
			manifest,
		);
		expect(JSON.stringify(result.document.root[0])).toBe(
			'{"id":"a","type":"hero","modes":["teaser"],"props":{"heading":"x","dark":false}}',
		);
		const notList = validateDocument({ version: 1, root: [{ ...hero('a'), modes: 'teaser' }] }, manifest);
		expect(notList.document.root[0]?.modes).toBeUndefined();
		expect(notList.issues.some((i) => i.path.endsWith('.modes'))).toBe(true);
	});
});

describe('mode slots', () => {
	it('are the area key for Full and `area.mode` otherwise', () => {
		expect(modeSlot('main', 'full')).toBe('main');
		expect(modeSlot('main', 'teaser')).toBe('main.teaser');
		expect(parseModeSlot('main.teaser')).toEqual({ area: 'main', mode: 'teaser' });
		expect(parseModeSlot('main')).toEqual({ area: 'main', mode: 'full' });
		expect(parseModeSlot('main.full')).toBeNull();
		expect(parseModeSlot('main.teaser.x')).toBeNull();
		expect(parseModeSlot('Main')).toBeNull();
		expect(parseModeSlot('.teaser')).toBeNull();
	});

	it('are accepted on a templated page’s top-level nodes, nowhere else', () => {
		const page = validateDocument(
			doc([hero('a', { slot: 'main.teaser' }), hero('b', { slot: 'main.x y' })], T1),
			manifest,
		);
		expect(page.document.root.map((n) => n.slot)).toEqual(['main.teaser', undefined]);
		const oneOff = validateDocument(doc([hero('a', { slot: 'main.teaser' })]), manifest);
		expect(oneOff.document.root[0]?.slot).toBeUndefined();
	});

	it('make a slot per mode on the root, in the site’s mode order', () => {
		const modes = parseModes({ modes: [{ key: 'card', name: 'Card' }] });
		const root = withRootAreas(
			manifest,
			[
				{ key: 'main', name: 'Main', modes: ['card', 'teaser', 'full'] },
				{ key: 'side', name: 'Side' },
			],
			modes,
		)[ROOT_ENTRY];
		expect(root?.slots).toEqual({
			main: { label: 'Main · Full' },
			'main.teaser': { label: 'Main · Teaser' },
			'main.card': { label: 'Main · Card' },
			side: { label: 'Side' },
		});
		// Without display modes (no companion), areas keep one slot.
		expect(
			withRootAreas(manifest, [{ key: 'main', name: 'Main', modes: ['full', 'teaser'] }])[ROOT_ENTRY]?.slots,
		).toEqual({
			main: { label: 'Main' },
		});
	});
});

describe('templates in a display mode', () => {
	const template = doc([
		hero('banner'),
		hero('badge', { modes: ['teaser'] }),
		{
			id: 'box',
			type: 'section',
			modes: ['full', 'teaser'],
			props: {},
			children: [hero('inner'), area('body', 'Main', ['full', 'teaser'])],
		},
		area('side', 'Side'),
	]);
	const page = doc(
		[hero('article', { slot: 'main' }), hero('summary', { slot: 'main.teaser' }), hero('aside', { slot: 'side' })],
		T1,
	);

	it('report each area’s modes within its containers', () => {
		expect(templateAreas(template)).toEqual([
			{ key: 'main', name: 'Main', modes: ['full', 'teaser'] },
			{ key: 'side', name: 'Side' },
		]);
		const narrowed = doc([
			{ id: 'box', type: 'section', props: {}, children: [area('a', 'Main', ['full', 'teaser'])] },
		]);
		expect(templateAreas(narrowed)).toEqual([{ key: 'main', name: 'Main' }]);
	});

	it('render Full by default: Full components and each area’s Full content', () => {
		expect(ids(mergeTemplate(template, page))).toEqual([
			'tpl_banner',
			'tpl_box',
			'tpl_inner',
			'tpl_body',
			'article',
			'tpl_side',
			'aside',
		]);
	});

	it('render a teaser: Teaser components, the Teaser content, nothing only in Full', () => {
		expect(ids(mergeTemplate(template, page, { mode: 'teaser' }))).toEqual([
			'tpl_badge',
			'tpl_box',
			'tpl_body',
			'summary',
		]);
	});

	it('show an area’s tab in the canvas, whatever the rest shows', () => {
		const merged = mergeTemplate(template, page, { tabs: { main: 'teaser', side: 'teaser' } });
		// Main shows its Teaser tab; Side has no Teaser, so it shows Full.
		expect(ids(merged)).toEqual(['tpl_banner', 'tpl_box', 'tpl_inner', 'tpl_body', 'summary', 'tpl_side', 'aside']);
	});

	it('tell whether a page has content for a mode', () => {
		expect(hasModeContent(template, page, 'teaser')).toBe(true);
		expect(hasModeContent(template, doc([hero('article', { slot: 'main' })], T1), 'teaser')).toBe(false);
		expect(hasModeContent(template, page, 'card')).toBe(false);
	});

	it('keep a mode’s content with its area when the page switches template', () => {
		const moved = assignAreas(page, { template: 'tt_bbbbbbbbbbbbbbbb', areas: [{ key: 'content', name: 'Content' }] });
		expect(moved.root.map((n) => n.slot)).toEqual(['content', 'content.teaser', 'content']);
		const kept = assignAreas(page, { template: 'tt_bbbbbbbbbbbbbbbb', areas: [{ key: 'main', name: 'Main' }] });
		expect(kept.root.map((n) => n.slot)).toEqual(['main', 'main.teaser', 'main']);
	});
});

describe('select props with multiple choices', () => {
	const tags = defineComponent({
		type: 'tagged',
		label: 'Tagged',
		component: './T.astro',
		props: {
			tags: {
				type: 'select',
				label: 'Tags',
				multiple: true,
				options: [
					{ value: 'a', label: 'A' },
					{ value: 'b', label: 'B' },
				],
			},
			fromServer: { type: 'select', label: 'Server', multiple: true, options: [], optionsUrl: '/_x/options' },
		},
	});
	const m = toManifest([tags]);
	const def = m.tagged?.props?.tags;
	const server = m.tagged?.props?.fromServer;

	it('accept a list of distinct allowed choices', () => {
		if (!def || !server) throw new Error('missing');
		expect(validatePropValue(def, ['b', 'a'])).toBeNull();
		expect(validatePropValue(def, 'a')).toBe('must be a list of choices');
		expect(validatePropValue(def, ['a', 'a'])).toBe('lists a choice more than once');
		expect(validatePropValue(def, ['a', 'c'])).toMatch(/choice/);
		expect(validatePropValue(def, ['a', 1])).toMatch(/choice/);
		expect(validatePropValue(server, ['id_1', 'x-2'])).toBeNull();
		expect(validatePropValue(server, ['<script>'])).toMatch(/choice/);
		expect(
			validatePropValue(
				server,
				Array.from({ length: 101 }, (_, i) => `x${i}`),
			),
		).toMatch(/at most 100/);
	});

	it('convert a single choice and drop an empty list', () => {
		const out = validateDocument(
			{
				version: 1,
				root: [
					{ id: 'x', type: 'tagged', props: { tags: 'a' } },
					{ id: 'y', type: 'tagged', props: { tags: [] } },
				],
			},
			m,
		).document.root;
		expect(out[0]?.props.tags).toEqual(['a']);
		expect(out[1]?.props.tags).toBeUndefined();
	});

	it('check their defaults when defined', () => {
		const bad = (extra: object) => () =>
			toManifest([
				defineComponent({
					type: 'bad',
					label: 'Bad',
					component: './B.astro',
					props: { s: { type: 'select', label: 'S', options: [{ value: 'a', label: 'A' }], ...extra } },
				}),
			]);
		expect(bad({ multiple: true, default: ['a'] })).not.toThrow();
		expect(bad({ default: ['a'] })).toThrow(TapestryDefinitionError);
		expect(bad({ multiple: true, default: ['a', 'a'] })).toThrow(/more than once/);
		expect(bad({ multiple: true, default: ['z'] })).toThrow(/not one of the options/);
		expect(bad({ multiple: 'yes' })).toThrow(/multiple/);
	});
});

describe('components that get their node id', () => {
	const def =
		(extra: object, props: object = {}) =>
		() =>
			toManifest([
				defineComponent({ type: 'lister', label: 'Lister', component: './L.astro', props, ...extra } as never),
			]);

	it('ask for it with withNodeId, kept in the manifest', () => {
		expect(def({ withNodeId: true })().lister?.withNodeId).toBe(true);
	});

	it('can’t also have a prop called nodeId, and the flag is a boolean', () => {
		expect(def({ withNodeId: true }, { nodeId: { type: 'text', label: 'X' } })).toThrow(/nodeId/);
		expect(def({ withNodeId: 'yes' })).toThrow(/withNodeId/);
		expect(def({}, { nodeId: { type: 'text', label: 'X' } })).not.toThrow();
	});
});
