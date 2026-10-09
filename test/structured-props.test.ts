import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { displayValue } from '../src/editor/diff.js';
import { initialObject, initialPropValue } from '../src/editor/tree.js';
import { collectRefs } from '../src/resolve.js';
import { richTextFromPlain } from '../src/richtext.js';
import type { ListProp, ObjectProp } from '../src/types.js';
import { LIMITS, validateDocument, validatePropValue } from '../src/validate.js';

const faq = defineComponent({
	type: 'faq',
	label: 'FAQ',
	component: './Faq.astro',
	props: {
		items: {
			type: 'list',
			label: 'Questions',
			itemLabel: 'question',
			maxItems: 3,
			fields: {
				question: { type: 'text', label: 'Question', required: true },
				answer: { type: 'richtext', label: 'Answer', toolbar: ['bold'] },
				open: { type: 'boolean', label: 'Open', default: false },
			},
		},
		cta: {
			type: 'object',
			label: 'Call to action',
			fields: {
				label: { type: 'text', label: 'Label', maxLength: 20 },
				link: { type: 'link', label: 'Link' },
				image: { type: 'media', label: 'Image' },
			},
		},
	},
});
const manifest = toManifest([faq]);
const doc = (props: Record<string, unknown>) => ({ version: 1, root: [{ id: 'f', type: 'faq', props }] });
const clean = (props: Record<string, unknown>) => validateDocument(doc(props), manifest);

describe('list props', () => {
	it('keep valid items in order, fields in definition order, defaults filled', () => {
		const result = clean({
			items: [
				{ answer: 'Yes.', question: 'Is it fast?' },
				{ question: 'Is it light?', open: true },
			],
		});
		expect(result.valid).toBe(true);
		expect(JSON.stringify(result.document.root[0]?.props.items)).toBe(
			JSON.stringify([
				{ question: 'Is it fast?', answer: richTextFromPlain('Yes.'), open: false },
				{ question: 'Is it light?', open: true },
			]),
		);
	});

	it('drop invalid and empty items, with issues at their paths', () => {
		const result = clean({ items: [{ answer: 'no question' }, {}, { question: 'Kept' }, 'nope'] });
		expect(result.document.root[0]?.props.items).toEqual([{ question: 'Kept', open: false }]);
		expect(result.issues.map((i) => `${i.severity} ${i.path} ${i.message}`)).toEqual([
			'error root[0].props.items[0].question is required',
			'warning root[0].props.items[1] empty item removed',
			'error root[0].props.items[3] must be an object',
		]);
	});

	it('cap the number of items', () => {
		const items = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}` }));
		const result = clean({ items });
		expect(result.document.root[0]?.props.items).toHaveLength(3);
		expect(result.issues[0]).toMatchObject({ severity: 'error', path: 'root[0].props.items[3]' });
	});

	it('enforce minItems and treat an empty list as no value', () => {
		const def: ListProp = { type: 'list', label: 'L', minItems: 2, fields: { a: { type: 'text', label: 'A' } } };
		expect(validatePropValue(def, [{ a: 'x' }])).toBe('needs at least 2 items');
		expect(validatePropValue(def, [{ a: 'x' }, { a: 'y' }])).toBeNull();
		expect(clean({ items: [] }).document.root[0]?.props.items).toBeUndefined();
	});

	it.each([
		['not an array', { question: 'x' }],
		['a string', 'x'],
		['a prototype-polluting item', [JSON.parse('{"__proto__":{"polluted":true},"question":"x"}')]],
	])('reject or neutralize %s', (_, items) => {
		const result = clean({ items });
		const stored = result.document.root[0]?.props.items as unknown;
		if (stored !== undefined) {
			expect(JSON.stringify(stored)).toBe('[{"question":"x","open":false}]');
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		} else {
			expect(result.issues.some((i) => i.severity === 'error')).toBe(true);
		}
	});

	it('apply field rules inside items (unsafe links, disallowed formatting)', () => {
		const result = clean({
			items: [
				{
					question: 'Q',
					answer: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'italic' }], text: 'A' }] }],
					},
				},
			],
			cta: { label: 'Go', link: 'javascript:alert(1)' },
		});
		const props = result.document.root[0]?.props as Record<string, unknown>;
		expect(JSON.stringify(props.items)).toBe(
			JSON.stringify([{ question: 'Q', answer: richTextFromPlain('A'), open: false }]),
		);
		expect(props.cta).toEqual({ label: 'Go' });
		expect(result.issues.map((i) => i.path)).toEqual(['root[0].props.items[0].answer', 'root[0].props.cta.link']);
	});
});

describe('object props', () => {
	it('keep known fields, warn about unknown ones, and drop when empty', () => {
		const result = clean({ cta: { link: { type: 'page', page: 'p1' }, label: 'Go', extra: 1 } });
		expect(JSON.stringify(result.document.root[0]?.props.cta)).toBe(
			'{"label":"Go","link":{"type":"page","page":"p1"}}',
		);
		expect(result.issues).toEqual([
			{ severity: 'warning', path: 'root[0].props.cta.extra', message: 'unknown field; it will be ignored' },
		]);
		expect(clean({ cta: {} }).document.root[0]?.props.cta).toBeUndefined();
		expect(clean({ cta: [] }).issues[0]?.message).toBe('must be an object');
	});

	it('validatePropValue reports field problems with their path', () => {
		const def = faq.props.cta as ObjectProp;
		expect(validatePropValue(def, { label: 'x'.repeat(21) })).toBe('label must be at most 20 characters');
		expect(validatePropValue(def, { label: 'ok' })).toBeNull();
		expect(validatePropValue(def, { link: '/x' })).toBe('is not in the stored format');
	});
});

describe('definitions', () => {
	const define = (prop: unknown) =>
		defineComponent({ type: 'x', label: 'X', component: './X.astro', props: { p: prop as ListProp } });
	it.each([
		['no fields', { type: 'list', label: 'L', fields: {} }],
		[
			'a nested list',
			{
				type: 'list',
				label: 'L',
				fields: { a: { type: 'list', label: 'A', fields: { b: { type: 'text', label: 'B' } } } },
			},
		],
		[
			'a nested object',
			{
				type: 'object',
				label: 'O',
				fields: { a: { type: 'object', label: 'A', fields: { b: { type: 'text', label: 'B' } } } },
			},
		],
		['a reserved field name', { type: 'object', label: 'O', fields: { onclick: { type: 'text', label: 'A' } } }],
		[
			'maxItems over the limit',
			{ type: 'list', label: 'L', maxItems: LIMITS.listMaxItems + 1, fields: { a: { type: 'text', label: 'A' } } },
		],
		[
			'minItems over maxItems',
			{ type: 'list', label: 'L', minItems: 3, maxItems: 2, fields: { a: { type: 'text', label: 'A' } } },
		],
		[
			'an invalid default',
			{ type: 'list', label: 'L', default: [{ a: 5 }], fields: { a: { type: 'text', label: 'A' } } },
		],
		['an invalid field', { type: 'object', label: 'O', fields: { a: { type: 'select', label: 'A', options: [] } } }],
	])('reject %s', (_, prop) => {
		expect(() => define(prop)).toThrow(TapestryDefinitionError);
	});

	it('accept a list with a valid default', () => {
		expect(() =>
			define({ type: 'list', label: 'L', default: [{ a: 'x' }], fields: { a: { type: 'text', label: 'A' } } }),
		).not.toThrow();
	});
});

describe('editor helpers', () => {
	it('initial values give new components valid lists and objects', () => {
		const required: ListProp = {
			type: 'list',
			label: 'L',
			required: true,
			fields: {
				title: { type: 'text', label: 'Title', required: true },
				flag: { type: 'boolean', label: 'F', default: true },
			},
		};
		expect(initialPropValue(required)).toEqual([{ title: 'Title', flag: true }]);
		expect(initialPropValue({ ...required, required: false })).toBeUndefined();
		expect(initialPropValue({ ...required, required: false, minItems: 2 })).toHaveLength(2);
		expect(initialObject({ a: { type: 'text', label: 'A' } })).toEqual({});
		const result = validateDocument(
			{ version: 1, root: [{ id: 'n', type: 't', props: { l: initialPropValue(required) } }] },
			toManifest([defineComponent({ type: 't', label: 'T', component: './T.astro', props: { l: required } })]),
		);
		expect(result.valid).toBe(true);
	});

	it('displayValue summarizes lists and objects', () => {
		const items = faq.props.items as ListProp;
		expect(displayValue([{ question: 'A?' }, { question: 'B?' }], items)).toBe('2 questions: A?, B?');
		expect(displayValue([{ open: true }], items)).toBe('1 question');
		expect(displayValue({ label: 'Go', link: { type: 'url', url: '/x' } }, faq.props.cta)).toBe('Label: Go; Link: /x');
	});
});

describe('collectRefs', () => {
	it('finds media and links at every level without mutating the input', () => {
		const defs = {
			image: { type: 'media', label: 'I' },
			cta: faq.props.cta,
			items: {
				type: 'list',
				label: 'L',
				fields: { link: { type: 'link', label: 'Link' }, title: { type: 'text', label: 'T' } },
			},
		} as const;
		const input = {
			image: 'm_aaaaaaaaaaaaaaaa',
			cta: { label: 'Go', link: { type: 'page', page: 'p1' } },
			items: [{ link: { type: 'url', url: '/a' }, title: 'A' }, { title: 'B' }],
		};
		const snapshot = JSON.stringify(input);
		const { props, refs } = collectRefs(defs, input);
		expect(refs.map((r) => [r.kind, r.value])).toEqual([
			['media', 'm_aaaaaaaaaaaaaaaa'],
			['link', { type: 'page', page: 'p1' }],
			['media', undefined],
			['link', { type: 'url', url: '/a' }],
			['link', undefined],
		]);
		for (const ref of refs) ref.set(ref.value ? `resolved:${ref.kind}` : null);
		expect(props).toEqual({
			image: 'resolved:media',
			cta: { label: 'Go', link: 'resolved:link', image: null },
			items: [
				{ link: 'resolved:link', title: 'A' },
				{ link: null, title: 'B' },
			],
		});
		expect(JSON.stringify(input)).toBe(snapshot);
	});
});
