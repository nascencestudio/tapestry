import { __unsafeHTML, transform } from 'ultrahtml';
import sanitize from 'ultrahtml/transformers/sanitize';
import swap from 'ultrahtml/transformers/swap';
import { describe, expect, it } from 'vitest';
import { decodeProps, encodeProps, escapeAttribute, renderDocument, sanitizeOptions } from '../src/render.js';
import { parseDocument } from '../src/validate.js';
import { manifest } from './fixtures.js';

const tricky = `Say "hi" <b>&amp;</b> 'quoted' 100% %22 ü 🎉`;

const doc = {
	version: 1,
	root: [
		{
			id: 's1',
			type: 'section',
			props: { width: 'narrow' },
			children: [{ id: 'h1', type: 'hero', props: { heading: 'Hello', columns: 2 } }],
		},
	],
};

function render(input: unknown): string {
	return renderDocument(parseDocument(JSON.stringify(input), manifest).document);
}

describe('renderDocument', () => {
	it('renders a <tapestry-root> with nested <tapestry-node> elements and encoded props', () => {
		expect(render(doc)).toBe(
			'<tapestry-root>' +
				`<tapestry-node id="s1" type="section" props="${encodeProps({ width: 'narrow' })}">` +
				`<tapestry-node id="h1" type="hero" props="${encodeProps({ heading: 'Hello', columns: 2, dark: false })}"></tapestry-node>` +
				'</tapestry-node>' +
				'</tapestry-root>',
		);
	});

	it('produces attribute values that need no HTML escaping', () => {
		const html = render({ version: 1, root: [{ id: 'h1', type: 'hero', props: { heading: tricky } }] });
		const value = /props="([^"]*)"/.exec(html)?.[1] ?? '';
		expect(value).not.toMatch(/["&<>]/);
		expect(decodeProps(value)).toEqual({ heading: tricky, dark: false });
	});

	it('cannot break out of the props attribute', () => {
		const html = render({
			version: 1,
			root: [{ id: 'h1', type: 'hero', props: { heading: '"><script>alert(1)</script>' } }],
		});
		expect(html).not.toContain('<script');
		expect(html.match(/"/g)).toHaveLength(6);
	});

	it('renders an empty root for an empty document', () => {
		expect(renderDocument({ version: 1, root: [] })).toBe('<tapestry-root></tapestry-root>');
	});
});

describe('encodeProps / decodeProps', () => {
	it('round-trips typed values', () => {
		const props = { a: tricky, n: 3.5, b: true };
		expect(decodeProps(encodeProps(props))).toEqual(props);
	});
});

describe('escapeAttribute', () => {
	it('escapes &, ", < and >', () => {
		expect(escapeAttribute(`&"<>'`)).toBe(`&amp;&quot;&lt;&gt;'`);
	});
});

/**
 * Runs our output through the same ultrahtml sanitize + swap pipeline that
 * StudioCMS's component registry uses (see docs/research/studiocms-internals.md).
 * A stand-in for Node.astro records what it receives.
 */
describe('StudioCMS pipeline compatibility', () => {
	type Received = { type: string; props: Record<string, unknown>; children: string };

	async function pipeline(html: string) {
		const received: Received[] = [];
		const output = await transform(html, [
			sanitize(sanitizeOptions),
			swap({
				'tapestry-root': (_attrs: Record<string, string>, children: { value?: string } | undefined) =>
					__unsafeHTML(children?.value ?? ''),
				'tapestry-node': (attrs: Record<string, string>, children: { value?: string } | undefined) => {
					received.push({
						type: attrs.type ?? '',
						props: decodeProps(attrs.props ?? ''),
						children: children?.value ?? '',
					});
					return __unsafeHTML(`<div data-type="${attrs.type}">${children?.value ?? ''}</div>`);
				},
			} as never),
		]);
		return { output, received };
	}

	it('delivers type and props to the wrapper byte-for-byte, including special characters', async () => {
		const html = render({ version: 1, root: [{ id: 'h1', type: 'hero', props: { heading: tricky, columns: 3 } }] });
		const { received } = await pipeline(html);
		expect(received).toEqual([{ type: 'hero', props: { heading: tricky, columns: 3, dark: false }, children: '' }]);
	});

	it('renders nested nodes', async () => {
		const { output } = await pipeline(render(doc));
		expect(output).toBe('<div data-type="section"><div data-type="hero"></div></div>');
	});

	it('passes node ids to the wrapper', async () => {
		const ids: string[] = [];
		await transform(render(doc), [
			sanitize(sanitizeOptions),
			swap({
				'tapestry-root': (_a: Record<string, string>, c: { value?: string } | undefined) =>
					__unsafeHTML(c?.value ?? ''),
				'tapestry-node': (attrs: Record<string, string>, c: { value?: string } | undefined) => {
					ids.push(attrs.id ?? '');
					return __unsafeHTML(c?.value ?? '');
				},
			} as never),
		]);
		expect(ids.sort()).toEqual(['h1', 's1']);
	});

	it('drops everything that is not a Tapestry element', async () => {
		const { output } = await pipeline(
			'<script>alert(1)</script><img src=x onerror=alert(1)><other-thing></other-thing><Foo></Foo>',
		);
		expect(output).toBe('');
	});
});
