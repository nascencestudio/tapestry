import { describe, expect, it } from 'vitest';
import { isExternal, resolvedLink } from '../src/access.js';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { cleanLinkValue, LIMITS, validateDocument } from '../src/validate.js';

const button = defineComponent({
	type: 'button',
	label: 'Button',
	component: './Button.astro',
	props: {
		label: { type: 'text', label: 'Label' },
		href: { type: 'link', label: 'Link', required: true },
	},
});
const manifest = toManifest([button]);

describe('cleanLinkValue', () => {
	it('reads strings as web addresses (the url prop format)', () => {
		expect(cleanLinkValue('/about')).toEqual({ type: 'url', url: '/about' });
		expect(cleanLinkValue('https://example.com/x?y#z')).toEqual({ type: 'url', url: 'https://example.com/x?y#z' });
		expect(cleanLinkValue('mailto:a@b.c')).toEqual({ type: 'url', url: 'mailto:a@b.c' });
	});

	it('keeps page links by id and normalizes key order and newTab', () => {
		expect(cleanLinkValue({ newTab: true, page: 'abc-123', type: 'page' })).toEqual({
			type: 'page',
			page: 'abc-123',
			newTab: true,
		});
		expect(JSON.stringify(cleanLinkValue({ newTab: true, page: 'abc-123', type: 'page' }))).toBe(
			'{"type":"page","page":"abc-123","newTab":true}',
		);
		expect(cleanLinkValue({ type: 'url', url: '/x', newTab: 'yes' })).toEqual({ type: 'url', url: '/x' });
		expect(cleanLinkValue({ type: 'url', url: '/x', newTab: false })).toEqual({ type: 'url', url: '/x' });
	});

	it.each([
		'javascript:alert(1)',
		' javascript:alert(1)',
		'jav\tascript:alert(1)',
		'data:text/html,<script>alert(1)</script>',
		'vbscript:x',
		`/${'x'.repeat(LIMITS.urlMaxLength)}`,
		{ type: 'url', url: 'javascript:alert(1)' },
		{ type: 'page', page: '../../etc' },
		{ type: 'page', page: 'x'.repeat(65) },
		{ type: 'page', page: 42 },
		{ type: 'other', url: '/x' },
		null,
		42,
		['/x'],
	])('refuses %j', (value) => {
		expect(cleanLinkValue(value)).toBeNull();
	});
});

describe('link props in documents', () => {
	it('convert stored strings (a former url prop) and drop unsafe values', () => {
		const doc = (href: unknown) => ({ version: 1, root: [{ id: 'b', type: 'button', props: { label: 'Go', href } }] });
		expect(validateDocument(doc('/docs'), manifest).document.root[0]?.props.href).toEqual({
			type: 'url',
			url: '/docs',
		});
		const unsafe = validateDocument(doc('javascript:alert(1)'), manifest);
		expect(unsafe.document.root).toEqual([]); // required link invalid: node dropped
		expect(unsafe.issues[0]?.path).toBe('root[0].props.href');
	});

	it('rejects unsafe link defaults in definitions', () => {
		expect(() =>
			defineComponent({
				type: 'bad',
				label: 'Bad',
				component: './Bad.astro',
				props: { href: { type: 'link', label: 'Link', default: 'javascript:alert(1)' } },
			}),
		).toThrow(TapestryDefinitionError);
	});
});

describe('isExternal and resolvedLink', () => {
	it('detects other hosts, mailto and tel', () => {
		expect(isExternal('https://other.example/x', 'site.example')).toBe(true);
		expect(isExternal('//other.example/x', 'site.example')).toBe(true);
		expect(isExternal('https://SITE.example/x', 'site.example')).toBe(false);
		expect(isExternal('/about', 'site.example')).toBe(false);
		expect(isExternal('#top', 'site.example')).toBe(false);
		expect(isExternal('mailto:a@b.c', 'site.example')).toBe(true);
		expect(isExternal('tel:+123', 'site.example')).toBe(true);
	});

	it('adds rel only for new-tab links', () => {
		expect(resolvedLink('/a', {}, false, 'A')).toEqual({
			href: '/a',
			external: false,
			newTab: false,
			rel: undefined,
			title: 'A',
		});
		expect(resolvedLink('https://x.example', { newTab: true }, true, null).rel).toBe('noopener noreferrer');
	});
});
