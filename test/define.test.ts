import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import { components } from './fixtures.js';

const base = { label: 'X', component: './X.astro' };

describe('defineComponent', () => {
	it.each(['hero', 'card-grid', 'a1-b2-c3'])('accepts kebab-case type %s', (type) => {
		expect(() => defineComponent({ ...base, type })).not.toThrow();
	});

	it.each(['Hero', 'card_grid', '1-hero', 'hero-', '-hero', 'a--b', 'my card', ''])('rejects type %j', (type) => {
		expect(() => defineComponent({ ...base, type })).toThrow(TapestryDefinitionError);
	});

	it('requires an .astro or framework component path', () => {
		for (const component of ['./X.ts', './X.js', './X.astro.js', './X.html'])
			expect(() => defineComponent({ ...base, type: 'a', component })).toThrow(/\.astro/);
		for (const component of ['./X.astro', './X.tsx', './X.jsx', './X.svelte', './X.vue'])
			expect(() => defineComponent({ ...base, type: 'a', component })).not.toThrow();
	});

	it('client: only for framework components, only known directives', () => {
		expect(() => defineComponent({ ...base, type: 'a', component: './X.tsx', client: 'visible' })).not.toThrow();
		expect(() => defineComponent({ ...base, type: 'a', component: './X.astro', client: 'load' })).toThrow(
			TapestryDefinitionError,
		);
		expect(() => defineComponent({ ...base, type: 'a', component: './X.tsx', client: 'only' as never })).toThrow(
			TapestryDefinitionError,
		);
	});

	it.each(['class', 'style', 'id', 'slot', 'onclick', 'onMouseOver', 'online', 'data-x', 'with space', '1st'])(
		'rejects prop name %j',
		(name) => {
			expect(() => defineComponent({ ...base, type: 'a', props: { [name]: { type: 'text', label: 'P' } } })).toThrow(
				TapestryDefinitionError,
			);
		},
	);

	it('accepts camelCase prop names', () => {
		expect(() =>
			defineComponent({ ...base, type: 'a', props: { buttonLabel: { type: 'text', label: 'P' } } }),
		).not.toThrow();
	});

	it('rejects a select default that is not an option', () => {
		expect(() =>
			defineComponent({
				...base,
				type: 'a',
				props: { p: { type: 'select', label: 'P', options: [{ value: 'a', label: 'A' }], default: 'z' } },
			}),
		).toThrow(/not one of the options/);
	});

	it('rejects a select with no options', () => {
		expect(() =>
			defineComponent({ ...base, type: 'a', props: { p: { type: 'select', label: 'P', options: [] } } }),
		).toThrow(/at least one option/);
	});

	it('rejects number min > max', () => {
		expect(() =>
			defineComponent({ ...base, type: 'a', props: { p: { type: 'number', label: 'P', min: 5, max: 1 } } }),
		).toThrow(/min is greater than max/);
	});
});

describe('toManifest', () => {
	it('keys entries by type and strips file paths', () => {
		const manifest = toManifest(components);
		expect(Object.keys(manifest)).toEqual(['section', 'hero']);
		expect(manifest.hero).not.toHaveProperty('component');
		expect(manifest.hero?.label).toBe('Hero');
	});

	it('rejects duplicate types', () => {
		const dup = defineComponent({ ...base, type: 'a' });
		expect(() => toManifest([dup, dup])).toThrow(/more than once/);
	});
});

describe('select choices from the server (optionsUrl)', async () => {
	const { validatePropValue } = await import('../src/validate.js');
	const select = (extra: Record<string, unknown>) => ({
		type: 'x',
		label: 'X',
		component: './X.astro',
		props: { menu: { type: 'select', label: 'Menu', options: [], ...extra } },
	});

	it('need a path on this site', () => {
		expect(() => defineComponent(select({ optionsUrl: '/_menus/options' }) as never)).not.toThrow();
		for (const url of ['https://evil.example/o', '//evil.example/o', '/a/../b', 'relative', 'javascript:alert(1)']) {
			expect(() => defineComponent(select({ optionsUrl: url }) as never), url).toThrow();
		}
		expect(() => defineComponent(select({}) as never)).toThrow(/at least one option/);
	});

	it('accept ids as values (the list is only known in the editor)', () => {
		const def = { type: 'select' as const, label: 'Menu', options: [], optionsUrl: '/_menus/options' };
		expect(validatePropValue(def, 'mn_abc123')).toBeNull();
		expect(validatePropValue(def, 'has space')).not.toBeNull();
		expect(validatePropValue(def, '<script>')).not.toBeNull();
		expect(validatePropValue({ ...def, optionsUrl: undefined }, 'mn_abc123')).not.toBeNull();
	});
});
