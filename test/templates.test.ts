import { describe, expect, it } from 'vitest';
import {
	cleanName,
	newId,
	PART_ID,
	parsePart,
	parseTemplate,
	partDocument,
	resolveTemplate,
	TEMPLATE_ID,
	templatesUsing,
} from '../src/templates.js';
import { validateDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const T1 = 'tt_aaaaaaaaaaaaaaaa';
const T2 = 'tt_bbbbbbbbbbbbbbbb';
const H1 = 'tp_hhhhhhhhhhhhhhhh';
const F1 = 'tp_ffffffffffffffff';
const hero = (heading: string) => ({ version: 1 as const, root: [{ id: 'h1', type: 'hero', props: { heading } }] });

describe('a page’s template choice', () => {
	it('is kept on the document, between version and root (documents are compared as strings)', () => {
		const { document, issues } = validateDocument({ version: 1, root: [], template: T1 }, manifest);
		expect(JSON.stringify(document)).toBe(`{"version":1,"template":"${T1}","root":[]}`);
		expect(issues).toEqual([]);
	});

	it.each([
		['not a string', 5],
		['a malformed id', 'tt_../../x'],
		['an id with markup', '<script>'],
		['a part id', H1],
	])('drops %s with a warning (the default template is used)', (_, template) => {
		const { document, issues, valid } = validateDocument({ version: 1, root: [], template }, manifest);
		expect(document).toEqual({ version: 1, root: [] });
		expect(issues).toEqual([expect.objectContaining({ severity: 'warning', path: 'template' })]);
		expect(valid).toBe(true);
	});

	it('is absent from documents that never chose one', () => {
		expect(JSON.stringify(validateDocument({ version: 1, root: [] }, manifest).document)).toBe(
			'{"version":1,"root":[]}',
		);
	});
});

describe('templates and parts', () => {
	it('make ids of the right shape', () => {
		const random = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7);
		expect(newId('tt_', random)).toMatch(TEMPLATE_ID);
		expect(newId('tp_', random)).toMatch(PART_ID);
	});

	it('clean names to one capped line; empty names are unusable', () => {
		expect(cleanName('  Main\nheader\t ')).toBe('Main header');
		expect(cleanName('x'.repeat(200))).toHaveLength(80);
		expect(cleanName(42)).toBe('');
		expect(parseTemplate({ id: T1, name: '   ' })).toBeNull();
	});

	it('parse templates, dropping part references that aren’t part ids', () => {
		expect(parseTemplate({ id: T1, name: 'Standard', header: H1, footer: 'nope' })).toEqual({
			id: T1,
			name: 'Standard',
			header: H1,
			footer: null,
		});
		expect(parseTemplate({ id: 'tt_short', name: 'X' })).toBeNull();
		expect(parseTemplate(null)).toBeNull();
	});

	it('parse parts with validated documents (unknown components dropped)', () => {
		const page = {
			version: 2,
			published: hero('Live'),
			publishedAt: '2026-10-14T00:00:00.000Z',
			draft: { version: 1, root: [{ id: 'x', type: 'not-a-component', props: {} }] },
			history: [],
		};
		const part = parsePart({ id: H1, region: 'header', name: 'Main header', page }, manifest, 5);
		expect(part?.region).toBe('header');
		expect(part?.page.published?.root[0]?.props.heading).toBe('Live');
		expect(part?.page.draft?.root).toEqual([]);
		expect(parsePart({ id: H1, region: 'sidebar', name: 'X', page }, manifest, 5)).toBeNull();
	});

	it('resolve a page’s template: its own, else the default, else none', () => {
		const templates = [
			{ id: T1, name: 'Standard', header: H1, footer: F1 },
			{ id: T2, name: 'Landing', header: null, footer: F1 },
		];
		expect(resolveTemplate({ template: T2 }, templates, T1)?.name).toBe('Landing');
		expect(resolveTemplate({}, templates, T1)?.name).toBe('Standard');
		expect(resolveTemplate({ template: 'tt_deleteddeleted00' }, templates, T1)?.name).toBe('Standard');
		expect(resolveTemplate({}, templates, null)).toBeNull();
		expect(templatesUsing(F1, templates).map((t) => t.name)).toEqual(['Standard', 'Landing']);
	});

	it('show visitors the published part and editors previewing the draft', () => {
		const page = {
			version: 2 as const,
			published: hero('Live'),
			publishedAt: null,
			draft: hero('Draft'),
			history: [],
		};
		expect(partDocument({ page }, false)?.root[0]?.props.heading).toBe('Live');
		expect(partDocument({ page }, true)?.root[0]?.props.heading).toBe('Draft');
		expect(partDocument({ page: { ...page, published: null } }, false)).toBeNull();
		expect(partDocument({ page: { ...page, draft: null } }, true)?.root[0]?.props.heading).toBe('Live');
	});
});
