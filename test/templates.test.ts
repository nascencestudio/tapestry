import { describe, expect, it } from 'vitest';
import { defineComponent, toManifest } from '../src/define.js';
import {
	AREA_TYPE,
	areaKey,
	assignAreas,
	cleanName,
	mergeTemplate,
	newId,
	PART_ID,
	parsePart,
	parseTemplate,
	TEMPLATE_ID,
	templateAreas,
	templatesUsing,
	versionFor,
} from '../src/templates.js';
import type { TapestryDocument } from '../src/types.js';
import { validateDocument } from '../src/validate.js';
import { manifest as fixtures } from './fixtures.js';

const T1 = 'tt_aaaaaaaaaaaaaaaa';
const H1 = 'tp_hhhhhhhhhhhhhhhh';
const F1 = 'tp_ffffffffffffffff';
// The built-in content area, as the plugin registers it.
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
const hero = (id: string, heading = id) => ({ id, type: 'hero', props: { heading } });
const area = (id: string, name: string) => ({ id, type: AREA_TYPE, props: { name } });

describe('a page’s template, header and footer', () => {
	it('are kept in key order: version, template | header, footer, root', () => {
		const withTemplate = validateDocument({ version: 1, root: [], template: T1 }, manifest).document;
		expect(JSON.stringify(withTemplate)).toBe(`{"version":1,"template":"${T1}","root":[]}`);
		const oneOff = validateDocument({ root: [], footer: F1, version: 1, header: H1 }, manifest).document;
		expect(JSON.stringify(oneOff)).toBe(`{"version":1,"header":"${H1}","footer":"${F1}","root":[]}`);
	});

	it('ignore a page’s own header and footer when it uses a template (the template’s apply)', () => {
		const { document } = validateDocument({ version: 1, template: T1, header: H1, root: [] }, manifest);
		expect(document).toEqual({ version: 1, template: T1, root: [] });
	});

	it.each([
		['template', 5],
		['template', 'tt_../../x'],
		['template', H1],
		['header', T1],
		['footer', '<script>'],
	])('drop a bad %s (%s) with a warning', (key, value) => {
		const { document, issues, valid } = validateDocument({ version: 1, root: [], [key]: value }, manifest);
		expect(document).toEqual({ version: 1, root: [] });
		expect(issues).toEqual([expect.objectContaining({ severity: 'warning', path: key })]);
		expect(valid).toBe(true);
	});

	it('let top-level nodes name a content area only with a template, and only safe area keys', () => {
		const withArea = validateDocument(
			{ version: 1, template: T1, root: [{ ...hero('a'), slot: 'sidebar' }] },
			manifest,
		);
		expect(withArea.document.root[0]?.slot).toBe('sidebar');
		const noTemplate = validateDocument({ version: 1, root: [{ ...hero('a'), slot: 'sidebar' }] }, manifest);
		expect(noTemplate.document.root[0]?.slot).toBeUndefined();
		const bad = validateDocument(
			{ version: 1, template: T1, root: [{ ...hero('a'), slot: 'Side Bar"><x>' }] },
			manifest,
		);
		expect(bad.document.root[0]?.slot).toBeUndefined();
		expect(bad.issues).toEqual([expect.objectContaining({ path: 'root[0].slot' })]);
	});
});

describe('content areas', () => {
	it('get keys from their names', () => {
		expect(areaKey('Main')).toBe('main');
		expect(areaKey(' Main  Content! ')).toBe('main-content');
		expect(areaKey('Café latéral')).toBe('cafe-lateral');
		expect(areaKey('2nd column')).toBe('area-2nd-column');
		expect(areaKey('')).toBe('main');
		expect(areaKey(42)).toBe('main');
		expect(areaKey('x'.repeat(100))).toHaveLength(40);
	});

	it('are listed in document order, nested ones included, one per key', () => {
		const doc = {
			version: 1 as const,
			root: [
				area('a1', 'Main'),
				{ id: 's', type: 'section', props: {}, children: [area('a2', 'Sidebar'), area('a3', 'main')] },
			],
		};
		expect(templateAreas(doc)).toEqual([
			{ key: 'main', name: 'Main' },
			{ key: 'sidebar', name: 'Sidebar' },
		]);
		expect(templateAreas(null)).toEqual([]);
	});
});

describe('merging a page into its template', () => {
	const template: TapestryDocument = {
		version: 1,
		root: [
			hero('banner', 'Fixed banner'),
			{ id: 's', type: 'section', props: {}, children: [area('main-area', 'Main'), area('side', 'Sidebar')] },
		],
	};

	it('puts each page node in its area and prefixes template ids', () => {
		const page: TapestryDocument = {
			version: 1,
			template: T1,
			root: [
				{ ...hero('p1'), slot: 'main' },
				{ ...hero('p2'), slot: 'sidebar' },
				{ ...hero('p3'), slot: 'main' },
			],
		};
		const merged = mergeTemplate(template, page);
		expect(merged.root[0]?.id).toBe('tpl_banner');
		const section = merged.root[1];
		expect(section?.id).toBe('tpl_s');
		expect(section?.children?.[0]?.children?.map((n) => n.id)).toEqual(['p1', 'p3']);
		expect(section?.children?.[1]?.children?.map((n) => n.id)).toEqual(['p2']);
		// The page nodes lose their area (it's where they are now); the result validates.
		expect(section?.children?.[0]?.children?.[0]).not.toHaveProperty('slot');
		expect(validateDocument(merged, manifest).issues).toEqual([]);
	});

	it('leaves out page nodes whose area the template doesn’t have, and nodes without an area', () => {
		const page: TapestryDocument = {
			version: 1,
			template: T1,
			root: [{ ...hero('gone'), slot: 'old-area' }, hero('loose')],
		};
		const ids = JSON.stringify(mergeTemplate(template, page));
		expect(ids).not.toContain('"gone"');
		expect(ids).not.toContain('"loose"');
	});

	it('can’t be tricked by a page node using a template id (prefixes keep them apart)', () => {
		const page: TapestryDocument = { version: 1, template: T1, root: [{ ...hero('banner'), slot: 'main' }] };
		const merged = mergeTemplate(template, page);
		expect(validateDocument(merged, manifest).issues.filter((i) => i.message.includes('duplicate'))).toEqual([]);
	});
});

describe('switching a page’s template', () => {
	const doc: TapestryDocument = {
		version: 1,
		template: T1,
		root: [
			{ ...hero('a'), slot: 'main' },
			{ ...hero('b'), slot: 'sidebar' },
		],
	};

	it('keeps areas the new template has and moves the rest to its first area', () => {
		const next = assignAreas(doc, {
			template: 'tt_bbbbbbbbbbbbbbbb',
			areas: [
				{ key: 'wide', name: 'Wide' },
				{ key: 'sidebar', name: 'Sidebar' },
			],
		});
		expect(next.template).toBe('tt_bbbbbbbbbbbbbbbb');
		expect(next.root.map((n) => n.slot)).toEqual(['wide', 'sidebar']);
	});

	it('drops areas when the page stops using a template (its own header and footer instead)', () => {
		const next = assignAreas(doc, { header: H1, footer: null });
		expect(JSON.stringify(next)).toBe(
			`{"version":1,"header":"${H1}","root":[{"id":"a","type":"hero","props":{"heading":"a"}},{"id":"b","type":"hero","props":{"heading":"b"}}]}`,
		);
	});
});

describe('stored templates and parts', () => {
	it('make ids of the right shape and clean names', () => {
		const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7);
		expect(newId('tt_', random)).toMatch(TEMPLATE_ID);
		expect(newId('tp_', random)).toMatch(PART_ID);
		expect(cleanName('  Main\nheader\t ')).toBe('Main header');
		expect(cleanName('x'.repeat(200))).toHaveLength(80);
	});

	it('parse rows with validated documents; drop unusable ones', () => {
		const page = {
			version: 2,
			published: { version: 1, root: [hero('h')] },
			publishedAt: '2026-10-15T00:00:00.000Z',
			draft: { version: 1, root: [{ id: 'x', type: 'not-a-component', props: {} }] },
			history: [],
		};
		const template = parseTemplate({ id: T1, name: 'Article', header: H1, footer: 'nope', page }, manifest, 5);
		expect(template).toMatchObject({ id: T1, name: 'Article', header: H1, footer: null });
		expect(template?.page.draft?.root).toEqual([]);
		expect(parseTemplate({ id: T1, name: ' ' }, manifest, 5)).toBeNull();
		expect(parsePart({ id: H1, region: 'header', name: 'Main', page }, manifest, 5)?.region).toBe('header');
		expect(parsePart({ id: H1, region: 'sidebar', name: 'Main', page }, manifest, 5)).toBeNull();
		expect(templatesUsing(H1, template ? [template] : []).map((t) => t.name)).toEqual(['Article']);
	});

	it('show visitors the published version and editors previewing the draft', () => {
		const page = {
			version: 2 as const,
			published: { version: 1 as const, root: [hero('live')] },
			publishedAt: null,
			draft: { version: 1 as const, root: [hero('draft')] },
			history: [],
		};
		expect(versionFor({ page }, false)?.root[0]?.id).toBe('live');
		expect(versionFor({ page }, true)?.root[0]?.id).toBe('draft');
		expect(versionFor({ page: { ...page, published: null } }, false)).toBeNull();
	});
});

describe('a page using a template, in the editor', async () => {
	const { insertNode, insertionTargetFor, moveNode } = await import('../src/editor/tree.js');
	const { withRootAreas, ROOT_ENTRY } = await import('../src/slots.js');
	const areas = [
		{ key: 'main', name: 'Main' },
		{ key: 'sidebar', name: 'Sidebar' },
	];
	const pageManifest = withRootAreas(manifest, areas);
	const doc: TapestryDocument = {
		version: 1,
		template: T1,
		root: [
			{ ...hero('a'), slot: 'main' },
			{ ...hero('b'), slot: 'sidebar' },
		],
	};

	it('has the template’s areas at its root (and none without one)', () => {
		expect(Object.keys(pageManifest[ROOT_ENTRY]?.slots ?? {})).toEqual(['main', 'sidebar']);
		expect(withRootAreas(pageManifest, null)).not.toHaveProperty(ROOT_ENTRY);
	});

	it('inserts into an area, keeping components grouped by area', () => {
		const next = insertNode(doc, pageManifest, hero('c'), { parentId: null, index: 2, slot: 'main' });
		expect(next?.root.map((n) => `${n.id}:${n.slot}`)).toEqual(['a:main', 'c:main', 'b:sidebar']);
		// An area the template doesn't have is refused.
		expect(insertNode(doc, pageManifest, hero('d'), { parentId: null, index: 0, slot: 'footer' })).toBeNull();
		// Without areas, the root takes no slot.
		expect(insertNode(doc, manifest, hero('d'), { parentId: null, index: 0, slot: 'main' })).toBeNull();
	});

	it('moves between areas, and adds new components to the first area by default', () => {
		const moved = moveNode(doc, pageManifest, 'b', { parentId: null, index: 0, slot: 'main' });
		expect(moved?.root.map((n) => `${n.id}:${n.slot}`)).toEqual(['b:main', 'a:main']);
		expect(insertionTargetFor(doc, pageManifest, null)).toEqual({ parentId: null, index: 2, slot: 'main' });
		expect(insertionTargetFor(doc, manifest, null)).toEqual({ parentId: null, index: 2 });
	});
});
