import { describe, expect, it } from 'vitest';
import { defineComponent, TapestryDefinitionError, toManifest } from '../src/define.js';
import {
	COMPONENTS_MODULE_ID,
	componentsModuleSource,
	MANIFEST_MODULE_ID,
	manifestModuleSource,
	tapestryVitePlugin,
	thumbnailsModuleSource,
} from '../src/vite.js';
import { components } from './fixtures.js';

const root = new URL('file:///project/');

describe('componentsModuleSource', () => {
	it('statically imports each component resolved against the project root', () => {
		expect(componentsModuleSource(components, root)).toBe(
			'import C0 from "/project/src/components/Section.astro";\n' +
				'import C1 from "/project/src/components/Hero.astro";\n' +
				'export default { "section": C0, "hero": C1 };\n',
		);
	});
});

describe('tapestryVitePlugin', () => {
	const plugin = tapestryVitePlugin(components, root);

	it('resolves only its own virtual modules', () => {
		expect(plugin.resolveId(MANIFEST_MODULE_ID)).toBe(`\0${MANIFEST_MODULE_ID}`);
		expect(plugin.resolveId(COMPONENTS_MODULE_ID)).toBe(`\0${COMPONENTS_MODULE_ID}`);
		expect(plugin.resolveId('virtual:other')).toBeUndefined();
	});

	it('serves a manifest without file paths', () => {
		const source = plugin.load(`\0${MANIFEST_MODULE_ID}`) ?? '';
		expect(source).toMatch(/^const manifest = \{.*\};\nexport default manifest;/s);
		expect(source).not.toContain('.astro');
	});

	it('attaches prop migrations from their modules (functions are not JSON)', () => {
		const source = manifestModuleSource(
			[
				{ type: 'hero', label: 'Hero', component: './Hero.astro', version: 2, migrations: './hero.migrations.mjs' },
				{ type: 'text', label: 'Text', component: './Text.astro' },
			],
			new URL('file:///site/'),
		);
		expect(source).toBe(
			[
				'import M0 from "/site/hero.migrations.mjs";',
				'const manifest = {"hero":{"type":"hero","label":"Hero","version":2},"text":{"type":"text","label":"Text"}};',
				'manifest["hero"].migrate = M0;',
				'export default manifest;',
				'',
			].join('\n'),
		);
	});
});

describe('media modules', () => {
	it('without the media library: empty lookup and a fallback component', async () => {
		const { mediaModuleSources } = await import('../src/vite.js');
		const sources = mediaModuleSources(null, '/x/MediaFallback.astro');
		expect(sources.server).toContain('export const enabled = false');
		expect(sources.server).toContain('"/x/MediaFallback.astro"');
		expect(sources.client).toContain('export const loadPicker = null');
	});

	it('with the media library: its server lookup, Media.astro and a lazy picker', async () => {
		const { mediaModuleSources } = await import('../src/vite.js');
		const sources = mediaModuleSources(
			{ server: '/m/server.js', picker: '/m/picker.js', media: '/m/Media.astro' },
			'/x/F.astro',
		);
		expect(sources.server).toContain('from "/m/server.js"');
		expect(sources.server).toContain('from "/m/Media.astro"');
		expect(sources.client).toContain('import("/m/picker.js")');
	});
});

describe('thumbnails', () => {
	const site = new URL('file:///site/');
	const base = { label: 'X', component: './src/X.astro' };
	it('imports each thumbnail as a URL, keyed by type (only components that have one)', () => {
		const source = thumbnailsModuleSource(
			[
				{ ...base, type: 'hero', thumbnail: './src/thumbs/hero.png' },
				{ ...base, type: 'text' },
			],
			site,
		);
		expect(source).toBe('import T0 from "/site/src/thumbs/hero.png?url";\nexport default { "hero": T0 };\n');
		expect(thumbnailsModuleSource([{ ...base, type: 'text' }], site)).toBe('\nexport default {  };\n');
	});

	it('only image files; the path never reaches the manifest', () => {
		expect(() => defineComponent({ ...base, type: 'a', thumbnail: './a.astro' })).toThrow(TapestryDefinitionError);
		expect(() => defineComponent({ ...base, type: 'a', thumbnail: './a.svg.js' })).toThrow(TapestryDefinitionError);
		const ok = defineComponent({ ...base, type: 'a', thumbnail: './a.WEBP' });
		expect(toManifest([ok]).a).toEqual({ type: 'a', label: 'X' });
	});
});
