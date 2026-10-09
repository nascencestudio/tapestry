import { Node as PMNode } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { schemaFor } from '../src/editor/richtext-schema.js';
import {
	cleanRichText,
	isRichTextEmpty,
	type RenderNode,
	RICH_TEXT_BUTTONS,
	RICH_TEXT_LIMITS,
	RICH_TEXT_TAGS,
	type RichTextButton,
	richTextFromPlain,
	richTextToPlain,
	stripDefaultAttrs,
	toRenderTree,
} from '../src/richtext.js';
import { isSafeUrl, validateDocument } from '../src/validate.js';

const all = { toolbar: RICH_TEXT_BUTTONS, isSafeUrl };
const t = (text: string, marks?: unknown[]) => (marks ? { type: 'text', text, marks } : { type: 'text', text });
const p = (...content: unknown[]) => ({ type: 'paragraph', content });
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('richTextFromPlain', () => {
	it('splits paragraphs on blank lines and keeps single line breaks', () => {
		expect(richTextFromPlain('One\ntwo\n\n  Three  \r\n\r\n')).toEqual(
			doc(p(t('One'), { type: 'hardBreak' }, t('two')), p(t('Three'))),
		);
	});
	it('gives an empty document for empty text', () => {
		expect(isRichTextEmpty(richTextFromPlain('  \n\n '))).toBe(true);
	});
	it('round-trips to plain text', () => {
		expect(richTextToPlain(richTextFromPlain('A\n\nB'))).toBe('A\n\nB');
	});
});

describe('cleanRichText', () => {
	it('keeps allowed formatting unchanged', () => {
		const value = doc(
			{ type: 'heading', attrs: { level: 3 }, content: [t('Title')] },
			p(t('Hi '), t('there', [{ type: 'link', attrs: { href: '/x' } }, { type: 'bold' }])),
			{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }] },
			{ type: 'blockquote', content: [p(t('quote'))] },
		);
		expect(cleanRichText(value, all)).toEqual({ value, changed: false });
	});

	it('converts plain strings (content saved before rich text) without reporting a change', () => {
		expect(cleanRichText('Hello\n\nWorld', all)).toEqual({
			value: richTextFromPlain('Hello\n\nWorld'),
			changed: false,
		});
	});

	it('removes formatting the toolbar does not allow, keeping the text', () => {
		const value = doc(
			{ type: 'heading', attrs: { level: 2 }, content: [t('Title', [{ type: 'underline' }])] },
			{ type: 'orderedList', content: [{ type: 'listItem', content: [p(t('item'))] }] },
			{ type: 'blockquote', content: [p(t('quote'))] },
		);
		const result = cleanRichText(value, { toolbar: ['bold'], isSafeUrl });
		expect(result.changed).toBe(true);
		expect(result.value).toEqual(doc(p(t('Title')), p(t('item')), p(t('quote'))));
	});

	it.each([
		'javascript:alert(1)',
		' JaVaScRiPt:alert(1)',
		'java\tscript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:msgbox(1)',
		'',
	])('unlinks unsafe href %j', (href) => {
		const result = cleanRichText(doc(p(t('click', [{ type: 'link', attrs: { href } }]))), all);
		expect(result.changed).toBe(true);
		expect(result.value).toEqual(doc(p(t('click'))));
	});

	it('keeps only href on links and drops unknown attributes and marks', () => {
		const result = cleanRichText(
			doc(
				p(
					t('x', [
						{ type: 'link', attrs: { href: 'https://a.example', onclick: 'alert(1)', target: '_blank' } },
						{ type: 'script' },
						{ type: 'bold' },
						{ type: 'bold' },
					]),
				),
			),
			all,
		);
		expect(result.value).toEqual(
			doc(p(t('x', [{ type: 'link', attrs: { href: 'https://a.example' } }, { type: 'bold' }]))),
		);
		expect(result.changed).toBe(true);
	});

	it('puts marks in canonical order and merges equal neighbouring runs', () => {
		const result = cleanRichText(
			doc(p(t('a', [{ type: 'italic' }, { type: 'bold' }]), t('b', [{ type: 'bold' }, { type: 'italic' }]))),
			all,
		);
		expect(result.value).toEqual(doc(p(t('ab', [{ type: 'bold' }, { type: 'italic' }]))));
	});

	it('drops unknown nodes, non-objects and empty text; never keeps raw HTML nodes', () => {
		const result = cleanRichText(
			doc(
				{ type: 'html', content: '<script>alert(1)</script>' },
				'just a string',
				null,
				p(t(''), { type: 'image', attrs: { src: 'x' } }, t('ok')),
			),
			all,
		);
		expect(result.value).toEqual(doc(p(t('ok'))));
		expect(result.changed).toBe(true);
	});

	it('repairs list items that do not start with a paragraph', () => {
		const result = cleanRichText(
			doc({
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x'))] }] }],
					},
				],
			}),
			all,
		);
		expect(result.value).toEqual(
			doc({
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [
							{ type: 'paragraph' },
							{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('x'))] }] },
						],
					},
				],
			}),
		);
	});

	it('ignores prototype tricks', () => {
		const hostile = JSON.parse(
			'{"type":"doc","content":[{"type":"paragraph","__proto__":{"polluted":true},"content":[{"type":"text","text":"x","marks":[{"type":"__proto__"},{"type":"constructor"}]}]}]}',
		);
		const result = cleanRichText(hostile, all);
		expect(result.value).toEqual(doc(p(t('x'))));
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it.each([
		['a non-doc object', { type: 'paragraph' }],
		['an array', []],
		['a number', 42],
		['null', null],
		['an object with a prototype', new Date()],
	])('rejects %s', (_label, value) => {
		expect(cleanRichText(value, all).problem).toBeTruthy();
	});

	it('enforces the text length limit (formatting not counted)', () => {
		expect(cleanRichText(doc(p(t('x'.repeat(11)))), { ...all, maxLength: 10 }).problem).toMatch(/at most 10/);
		expect(cleanRichText(doc(p(t('x'.repeat(10), [{ type: 'bold' }]))), { ...all, maxLength: 10 }).value).toBeDefined();
		expect(cleanRichText('x'.repeat(11), { ...all, maxLength: 10 }).problem).toMatch(/at most 10/);
	});

	it('enforces nesting and size limits', () => {
		let deep: unknown = p(t('x'));
		for (let i = 0; i < RICH_TEXT_LIMITS.maxDepth + 1; i++) deep = { type: 'blockquote', content: [deep] };
		expect(cleanRichText(doc(deep), all).problem).toMatch(/nested deeper/);

		const many = Array.from({ length: RICH_TEXT_LIMITS.maxNodes + 1 }, () => ({ type: 'hardBreak' }));
		expect(cleanRichText(doc(p(...many)), all).problem).toMatch(/more than/);
	});

	it('gives an empty document when nothing is left', () => {
		const result = cleanRichText(doc(), all);
		expect(result.value && isRichTextEmpty(result.value)).toBe(true);
	});
});

const tags = (nodes: RenderNode[]): string[] =>
	nodes.flatMap((n) => (typeof n === 'string' ? [] : [n.tag, ...tags(n.children)]));

describe('toRenderTree', () => {
	it('builds allowlisted elements with marks nested link-outermost', () => {
		const tree = toRenderTree(
			doc(
				p(t('Hi', [{ type: 'link', attrs: { href: '/a' } }, { type: 'bold' }, { type: 'italic' }]), {
					type: 'hardBreak',
				}),
			),
			isSafeUrl,
		);
		expect(tree).toEqual([
			{
				tag: 'p',
				children: [
					{
						tag: 'a',
						attrs: { href: '/a' },
						children: [{ tag: 'strong', children: [{ tag: 'em', children: ['Hi'] }] }],
					},
					{ tag: 'br', children: [] },
				],
			},
		]);
	});

	it('keeps markup-looking text as text (escaped when rendered)', () => {
		const tree = toRenderTree(doc(p(t('<script>alert(1)</script>'))), isSafeUrl);
		expect(tree).toEqual([{ tag: 'p', children: ['<script>alert(1)</script>'] }]);
	});

	it('never emits a tag outside the allowlist, even for hostile input', () => {
		const tree = toRenderTree(
			doc(
				{ type: 'heading', attrs: { level: 1 }, content: [t('h1?')] },
				{ type: 'heading', attrs: { level: '2><script>' }, content: [t('x')] },
				{ type: 'script', content: [t('x')] },
				p(t('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])),
			),
			isSafeUrl,
		);
		for (const tag of tags(tree)) expect(RICH_TEXT_TAGS).toContain(tag);
		expect(JSON.stringify(tree)).not.toContain('javascript');
	});

	it('renders plain strings and empty values', () => {
		expect(toRenderTree('A\n\nB', isSafeUrl)).toEqual([
			{ tag: 'p', children: ['A'] },
			{ tag: 'p', children: ['B'] },
		]);
		expect(toRenderTree(undefined, isSafeUrl)).toEqual([]);
		expect(toRenderTree(doc(p()), isSafeUrl)).toEqual([]);
	});
});

describe('editor schema (ProseMirror)', () => {
	const rich = doc(
		{ type: 'heading', attrs: { level: 3 }, content: [t('Title')] },
		p(
			t('Plain '),
			t('linked bold', [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'bold' }]),
			{ type: 'hardBreak' },
			t('struck', [{ type: 'italic' }, { type: 'underline' }, { type: 'strike' }]),
		),
		{
			type: 'orderedList',
			content: [
				{
					type: 'listItem',
					content: [p(t('one')), { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('nested'))] }] }],
				},
			],
		},
		{ type: 'blockquote', content: [p(t('quote'))] },
		{ type: 'paragraph' },
		{ type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [t('Big')] },
		{ type: 'heading', attrs: { level: 6 }, content: [t('Small')] },
		{
			type: 'paragraph',
			attrs: { textAlign: 'justify' },
			content: [t('H'), t('2', [{ type: 'subscript' }]), t('O x'), t('2', [{ type: 'superscript' }])],
		},
		{ type: 'horizontalRule' },
	);

	it('round-trips the stored format exactly, including key order', () => {
		const cleaned = cleanRichText(rich, all);
		expect(cleaned.changed).toBe(false);
		const node = PMNode.fromJSON(schemaFor(RICH_TEXT_BUTTONS), cleaned.value);
		// Byte-identical: documents are compared as JSON strings (draft vs published).
		expect(JSON.stringify(stripDefaultAttrs(node.toJSON()))).toBe(JSON.stringify(cleaned.value));
	});

	it('only contains what the toolbar allows', () => {
		const schema = schemaFor(['bold', 'bulletList']);
		expect(Object.keys(schema.marks)).toEqual(['bold']);
		expect(schema.nodes.heading).toBeUndefined();
		expect(schema.nodes.orderedList).toBeUndefined();
		expect(schema.nodes.bulletList).toBeDefined();
		expect(() => PMNode.fromJSON(schema, rich)).toThrow();
	});

	it('accepts every cleaned value for its own toolbar', () => {
		const toolbars: RichTextButton[][] = [
			[],
			['bold'],
			['heading2', 'blockquote'],
			['orderedList', 'link'],
			[...RICH_TEXT_BUTTONS],
		];
		for (const toolbar of toolbars) {
			const cleaned = cleanRichText(rich, { toolbar, isSafeUrl });
			const node = PMNode.fromJSON(schemaFor(toolbar), cleaned.value);
			expect(JSON.stringify(stripDefaultAttrs(node.toJSON()))).toBe(JSON.stringify(cleaned.value));
		}
	});
});

describe('richtext props in documents and definitions', () => {
	const text = defineComponent({
		type: 'text',
		label: 'Text',
		component: './Text.astro',
		props: { body: { type: 'richtext', label: 'Body', required: true, toolbar: ['bold'] } },
	});
	const manifest = toManifest([text]);
	const page = (body: unknown) => ({ version: 1, root: [{ id: 't1', type: 'text', props: { body } }] });

	it('converts plain strings silently', () => {
		const result = validateDocument(page('Hello'), manifest);
		expect(result.issues).toEqual([]);
		expect(result.document.root[0]?.props.body).toEqual(richTextFromPlain('Hello'));
	});

	it('removes disallowed formatting with a warning, keeping the node', () => {
		const result = validateDocument(page(doc(p(t('x', [{ type: 'italic' }])))), manifest);
		expect(result.valid).toBe(true);
		expect(result.issues).toEqual([expect.objectContaining({ severity: 'warning', path: 'root[0].props.body' })]);
		expect(result.document.root[0]?.props.body).toEqual(doc(p(t('x'))));
	});

	it('treats empty rich text as missing (required)', () => {
		const result = validateDocument(page(doc(p())), manifest);
		expect(result.document.root).toEqual([]);
		expect(result.issues[0]?.message).toBe('is required');
	});

	it('rejects values that are not rich text', () => {
		const result = validateDocument(page({ type: 'nope' }), manifest);
		expect(result.valid).toBe(false);
		expect(result.document.root).toEqual([]);
	});

	it('checks toolbar buttons and defaults when components are defined', () => {
		const define = (body: object) =>
			defineComponent({
				type: 'x',
				label: 'X',
				component: './X.astro',
				props: { body: { type: 'richtext', label: 'B', ...body } },
			});
		expect(() => define({ toolbar: ['bold', 'sparkles'] })).toThrow(TapestryDefinitionError);
		expect(() => define({ toolbar: ['bold', 'bold'] })).toThrow(/more than once/);
		expect(() => define({ toolbar: ['bold'], default: doc(p(t('x', [{ type: 'italic' }]))) })).toThrow(/default/);
		expect(() => define({ default: 'Plain default' })).not.toThrow();
	});
});

describe('headings, alignment, sub/superscript and horizontal lines', () => {
	const toolbar: RichTextButton[] = ['heading1', 'heading5', 'alignCenter', 'subscript', 'horizontalRule'];
	const opts = { toolbar, isSafeUrl };

	it('keeps allowed levels, alignments, marks and lines unchanged', () => {
		const value = doc(
			{ type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [t('A')] },
			{ type: 'heading', attrs: { level: 5 }, content: [t('B')] },
			{ type: 'paragraph', attrs: { textAlign: 'center' }, content: [t('C', [{ type: 'subscript' }])] },
			{ type: 'horizontalRule' },
		);
		expect(cleanRichText(value, opts)).toEqual({ value, changed: false });
	});

	it('removes levels, alignments, marks and lines the toolbar does not allow', () => {
		const result = cleanRichText(
			doc(
				{ type: 'heading', attrs: { level: 2, textAlign: 'right' }, content: [t('A')] },
				{ type: 'paragraph', attrs: { textAlign: 'sideways' }, content: [t('B', [{ type: 'superscript' }])] },
				{ type: 'horizontalRule' },
			),
			{ toolbar: ['bold'], isSafeUrl },
		);
		expect(result.changed).toBe(true);
		expect(result.value).toEqual(doc(p(t('A')), p(t('B'))));
	});

	it('treats an unset alignment as the default (no attribute stored)', () => {
		const result = cleanRichText(doc({ type: 'paragraph', attrs: { textAlign: null }, content: [t('x')] }), opts);
		expect(result).toEqual({ value: doc(p(t('x'))), changed: false });
	});

	it('keeps only one of subscript and superscript', () => {
		const result = cleanRichText(doc(p(t('x', [{ type: 'superscript' }, { type: 'subscript' }]))), all);
		expect(result.changed).toBe(true);
		expect(result.value).toEqual(doc(p(t('x', [{ type: 'subscript' }]))));
	});

	it('renders alignment as a fixed style, lines as <hr>, marks as <sub>/<sup>', () => {
		const tree = toRenderTree(
			doc(
				{ type: 'heading', attrs: { level: 6, textAlign: 'right' }, content: [t('H')] },
				{ type: 'paragraph', attrs: { textAlign: 'justify' }, content: [t('a', [{ type: 'superscript' }])] },
				{ type: 'paragraph', attrs: { textAlign: 'center; background:url(x)' }, content: [t('b')] },
				{ type: 'horizontalRule' },
			),
			isSafeUrl,
		);
		expect(tree).toEqual([
			{ tag: 'h6', attrs: { style: 'text-align: right' }, children: ['H'] },
			{ tag: 'p', attrs: { style: 'text-align: justify' }, children: [{ tag: 'sup', children: ['a'] }] },
			{ tag: 'p', children: ['b'] },
			{ tag: 'hr', children: [] },
		]);
	});

	it('stripDefaultAttrs drops unset alignment only', () => {
		expect(
			stripDefaultAttrs({
				type: 'heading',
				attrs: { level: 2, textAlign: null },
				content: [{ type: 'paragraph', attrs: { textAlign: null } }],
			}),
		).toEqual({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'paragraph' }] });
	});

	it('the editor schema only has the allowed levels and alignment', () => {
		const schema = schemaFor(toolbar);
		expect(schema.nodes.heading?.spec.parseDOM?.map((r) => r.tag)).toEqual(['h1', 'h5']);
		expect(schema.nodes.paragraph?.spec.attrs).toEqual({ textAlign: { default: null } });
		expect(Object.keys(schema.marks)).toEqual(['subscript']);
		expect(schemaFor(['bold']).nodes.paragraph?.spec.attrs).toBeUndefined();
	});
});

describe('media in rich text and media props', () => {
	const id = 'm_abcdefghij012345';
	it('keeps media blocks with valid ids when the toolbar allows media', () => {
		const value = doc(p(t('Intro')), { type: 'media', attrs: { id } });
		expect(cleanRichText(value, { toolbar: ['media'], isSafeUrl })).toEqual({ value, changed: false });
	});

	it('drops media blocks the toolbar does not allow, or with bad ids', () => {
		const bad = cleanRichText(
			doc({ type: 'media', attrs: { id: '../etc/passwd' } }, { type: 'media', attrs: { id: 'm_x' } }, p(t('x'))),
			{ toolbar: ['media'], isSafeUrl },
		);
		expect(bad.value).toEqual(doc(p(t('x'))));
		expect(cleanRichText(doc({ type: 'media', attrs: { id } }), { toolbar: ['bold'], isSafeUrl }).changed).toBe(true);
	});

	it('a field with only media is not empty; it renders as a media placeholder for Media.astro', () => {
		const value = doc({ type: 'media', attrs: { id } });
		expect(isRichTextEmpty(value as Parameters<typeof isRichTextEmpty>[0])).toBe(false);
		expect(toRenderTree(value, isSafeUrl)).toEqual([{ tag: 'media', attrs: { id }, children: [] }]);
	});

	it('round-trips media blocks through the editor schema', () => {
		const value = doc(p(t('a')), { type: 'media', attrs: { id } });
		const node = PMNode.fromJSON(schemaFor(['media']), value);
		expect(JSON.stringify(stripDefaultAttrs(node.toJSON()))).toBe(JSON.stringify(value));
	});

	it('media props accept only media ids, and definitions check the kinds', () => {
		const card = defineComponent({
			type: 'card',
			label: 'Card',
			component: './Card.astro',
			props: { image: { type: 'media', label: 'Image', accept: ['image'] } },
		});
		const manifest = toManifest([card]);
		const page = (image: unknown) => ({ version: 1, root: [{ id: 'c1', type: 'card', props: { image } }] });
		expect(validateDocument(page(id), manifest).document.root[0]?.props.image).toBe(id);
		expect(
			validateDocument(page('https://evil.example/x.png'), manifest).document.root[0]?.props.image,
		).toBeUndefined();
		expect(() =>
			defineComponent({
				type: 'x',
				label: 'X',
				component: './X.astro',
				props: { m: { type: 'media', label: 'M', accept: ['pdf' as never] } },
			}),
		).toThrow(TapestryDefinitionError);
	});
});
