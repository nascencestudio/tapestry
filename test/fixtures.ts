import { defineComponent, toManifest } from '../src/define.js';

export const section = defineComponent({
	type: 'section',
	label: 'Section',
	component: './src/components/Section.astro',
	acceptsChildren: true,
	props: {
		width: {
			type: 'select',
			label: 'Width',
			options: [
				{ value: 'narrow', label: 'Narrow' },
				{ value: 'wide', label: 'Wide' },
			],
			default: 'wide',
		},
	},
});

export const hero = defineComponent({
	type: 'hero',
	label: 'Hero',
	component: './src/components/Hero.astro',
	props: {
		heading: { type: 'text', label: 'Heading', required: true, maxLength: 50 },
		link: { type: 'url', label: 'Link' },
		columns: { type: 'number', label: 'Columns', min: 1, max: 4 },
		dark: { type: 'boolean', label: 'Dark', default: false },
	},
});

export const components = [section, hero];
export const manifest = toManifest(components);
