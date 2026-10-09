import { describe, expect, it } from 'vitest';
import { isSafeUrl, LIMITS, parseDocument, validateDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const hero = (id: string, props: Record<string, unknown> = { heading: 'Hi' }) => ({ id, type: 'hero', props });

describe('parseDocument', () => {
	it('treats empty content as an empty document', () => {
		expect(parseDocument('  ', manifest)).toEqual({ document: { version: 1, root: [] }, issues: [], valid: true });
	});

	it('reports invalid JSON without throwing', () => {
		const result = parseDocument('{nope', manifest);
		expect(result.valid).toBe(false);
		expect(result.issues[0]?.message).toMatch(/invalid JSON/);
	});

	it('rejects oversized content before parsing', () => {
		const result = parseDocument(`${' '.repeat(LIMITS.maxContentLength)}{}`, manifest);
		expect(result.valid).toBe(false);
		expect(result.issues[0]?.message).toMatch(/exceeds/);
	});

	it('rejects unsupported versions', () => {
		expect(parseDocument('{"version":2,"root":[]}', manifest).valid).toBe(false);
	});
});

describe('validateDocument', () => {
	it('accepts a valid nested document and fills defaults', () => {
		const result = validateDocument(
			{
				version: 1,
				root: [{ id: 's1', type: 'section', props: {}, children: [hero('h1')] }],
			},
			manifest,
		);
		expect(result.valid).toBe(true);
		expect(result.document.root).toEqual([
			{
				id: 's1',
				type: 'section',
				props: { width: 'wide' },
				children: [{ id: 'h1', type: 'hero', props: { heading: 'Hi', dark: false } }],
			},
		]);
	});

	it('drops unknown component types but keeps the rest', () => {
		const result = validateDocument(
			{ version: 1, root: [{ id: 'x', type: 'script', props: {} }, hero('h1')] },
			manifest,
		);
		expect(result.valid).toBe(false);
		expect(result.document.root.map((n) => n.id)).toEqual(['h1']);
	});

	it('ignores undeclared props with a warning', () => {
		const result = validateDocument(
			{ version: 1, root: [hero('h1', { heading: 'Hi', onclick: 'alert(1)', style: 'x' })] },
			manifest,
		);
		expect(result.valid).toBe(true);
		expect(result.issues.filter((i) => i.severity === 'warning')).toHaveLength(2);
		expect(result.document.root[0]?.props).toEqual({ heading: 'Hi', dark: false });
	});

	it('drops a node missing a required prop', () => {
		const result = validateDocument({ version: 1, root: [hero('h1', {})] }, manifest);
		expect(result.document.root).toEqual([]);
		expect(result.issues[0]).toMatchObject({ path: 'root[0].props.heading', message: 'is required' });
	});

	it.each([
		['heading', 42, /string/],
		['heading', 'x'.repeat(51), /at most 50/],
		['link', 'javascript:alert(1)', /relative URL/],
		['columns', 9, /at most 4/],
		['columns', Number.NaN, /finite/],
		['dark', 'yes', /true or false/],
	])('rejects invalid %s = %j', (prop, value, message) => {
		const result = validateDocument({ version: 1, root: [hero('h1', { heading: 'Hi', [prop]: value })] }, manifest);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => message.test(i.message))).toBe(true);
	});

	it('falls back to the default when an optional value is invalid', () => {
		const result = validateDocument({ version: 1, root: [hero('h1', { heading: 'Hi', dark: 'yes' })] }, manifest);
		expect(result.document.root[0]?.props.dark).toBe(false);
	});

	it('rejects bad and duplicate ids', () => {
		const result = validateDocument({ version: 1, root: [hero('a b'), hero('h1'), hero('h1')] }, manifest);
		expect(result.document.root.map((n) => n.id)).toEqual(['h1']);
		expect(result.issues.map((i) => i.message)).toEqual([expect.stringMatching(/id must match/), 'duplicate id "h1"']);
	});

	it('ignores children on components that do not accept them', () => {
		const result = validateDocument({ version: 1, root: [{ ...hero('h1'), children: [hero('h2')] }] }, manifest);
		expect(result.document.root[0]).not.toHaveProperty('children');
		expect(result.valid).toBe(false);
	});

	it('enforces the maximum depth', () => {
		let node: Record<string, unknown> = hero('leaf');
		for (let i = 0; i < LIMITS.maxDepth + 1; i++) {
			node = { id: `s${i}`, type: 'section', props: {}, children: [node] };
		}
		const result = validateDocument({ version: 1, root: [node] }, manifest);
		expect(result.valid).toBe(false);
		expect(result.issues.some((i) => /deeper than/.test(i.message))).toBe(true);
	});

	it('enforces the maximum node count', () => {
		const root = Array.from({ length: LIMITS.maxNodes + 10 }, (_, i) => hero(`h${i}`));
		const result = validateDocument({ version: 1, root }, manifest);
		expect(result.document.root).toHaveLength(LIMITS.maxNodes);
		expect(result.issues).toHaveLength(1);
	});

	it('does not let __proto__ keys pollute anything', () => {
		const input = JSON.parse(
			'{"version":1,"root":[{"id":"h1","type":"hero","props":{"heading":"Hi","__proto__":{"polluted":true}}}]}',
		);
		const result = validateDocument(input, manifest);
		expect(result.document.root[0]?.props).toEqual({ heading: 'Hi', dark: false });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it('rejects inherited Object.prototype names as types', () => {
		const result = validateDocument({ version: 1, root: [{ id: 'x', type: 'constructor', props: {} }] }, manifest);
		expect(result.document.root).toEqual([]);
	});
});

describe('isSafeUrl', () => {
	it.each(['/about', '#top', 'page?x=1', 'https://example.com', 'http://a.b', 'mailto:a@b.c', 'tel:+1555', ''])(
		'allows %s',
		(url) => expect(isSafeUrl(url)).toBe(true),
	);

	it.each(['javascript:alert(1)', 'JaVaScRiPt:x', ' javascript:x', 'java\tscript:x', 'data:text/html,x', 'vbscript:x'])(
		'blocks %j',
		(url) => expect(isSafeUrl(url)).toBe(false),
	);
});
