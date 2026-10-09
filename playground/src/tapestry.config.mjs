// @ts-check
// Components editors can place on Tapestry pages. Paths are relative to the
// project root. See docs/guides/defining-components.md.
import { defineComponent } from '@nascencestudio/tapestry';

const alignment = {
	type: /** @type {const} */ ('select'),
	label: 'Alignment',
	options: [
		{ value: 'left', label: 'Left' },
		{ value: 'center', label: 'Center' },
	],
	default: 'left',
};

export const components = [
	defineComponent({
		type: 'section',
		label: 'Section',
		description: 'A full-width band that holds other components.',
		category: 'Layout',
		component: './src/components/tapestry/Section.astro',
		acceptsChildren: true,
		props: {
			background: {
				type: 'select',
				label: 'Background',
				options: [
					{ value: 'none', label: 'None' },
					{ value: 'muted', label: 'Muted' },
					{ value: 'brand', label: 'Brand' },
				],
				default: 'none',
			},
			width: {
				type: 'select',
				label: 'Content width',
				options: [
					{ value: 'narrow', label: 'Narrow' },
					{ value: 'wide', label: 'Wide' },
				],
				default: 'wide',
			},
		},
	}),
	defineComponent({
		type: 'hero',
		// Only admins (and the owner) may add, change, move or remove the hero (ADR 0033).
		permission: 'admin',
		label: 'Hero',
		description: 'Large heading with optional subheading and call to action.',
		category: 'Content',
		component: './src/components/tapestry/Hero.astro',
		props: {
			heading: { type: 'text', label: 'Heading', required: true, maxLength: 120 },
			subheading: { type: 'textarea', label: 'Subheading', maxLength: 400 },
			ctaLabel: { type: 'text', label: 'Button label', maxLength: 40 },
			ctaHref: { type: 'url', label: 'Button link' },
			backgroundImage: {
				type: 'media',
				label: 'Background image',
				description: 'Optional. Shown behind the text with a dark overlay.',
				accept: ['image'],
			},
			align: alignment,
		},
	}),
	defineComponent({
		type: 'heading',
		label: 'Heading',
		category: 'Content',
		component: './src/components/tapestry/Heading.astro',
		props: {
			text: { type: 'text', label: 'Text', required: true },
			level: {
				type: 'select',
				label: 'Level',
				options: [
					{ value: '2', label: 'H2' },
					{ value: '3', label: 'H3' },
					{ value: '4', label: 'H4' },
				],
				default: '2',
			},
			align: alignment,
		},
	}),
	defineComponent({
		type: 'text',
		label: 'Text',
		description: 'Formatted text: headings, bold, italic, links, lists, quotes, alignment and more.',
		category: 'Content',
		component: './src/components/tapestry/Text.astro',
		props: {
			body: {
				type: 'richtext',
				label: 'Body',
				required: true,
				toolbar: [
					'heading1',
					'heading2',
					'heading3',
					'heading4',
					'heading5',
					'heading6',
					'bold',
					'italic',
					'strike',
					'subscript',
					'superscript',
					'link',
					'bulletList',
					'orderedList',
					'blockquote',
					'horizontalRule',
					'media',
					'alignLeft',
					'alignCenter',
					'alignRight',
					'alignJustify',
					'clearFormatting',
				],
			},
		},
	}),
	defineComponent({
		type: 'button',
		label: 'Button',
		category: 'Content',
		component: './src/components/tapestry/Button.astro',
		props: {
			label: { type: 'text', label: 'Label', required: true, maxLength: 40 },
			// A page on this site (kept working when its slug changes) or a web address. Stored
			// strings from the former `url` prop still work.
			href: { type: 'link', label: 'Link', required: true },
			variant: {
				type: 'select',
				label: 'Style',
				options: [
					{ value: 'primary', label: 'Primary' },
					{ value: 'secondary', label: 'Secondary' },
				],
				default: 'primary',
			},
		},
	}),
	defineComponent({
		type: 'faq',
		label: 'FAQ',
		description: 'Questions and answers that open on click (no JavaScript).',
		category: 'Content',
		component: './src/components/tapestry/Faq.astro',
		props: {
			heading: { type: 'text', label: 'Heading', maxLength: 120, default: 'Frequently asked questions' },
			// A repeater: editors add, remove and reorder questions.
			items: {
				type: 'list',
				label: 'Questions',
				itemLabel: 'question',
				required: true,
				maxItems: 30,
				fields: {
					question: { type: 'text', label: 'Question', required: true, maxLength: 200 },
					answer: { type: 'richtext', label: 'Answer', toolbar: ['bold', 'italic', 'link', 'bulletList'] },
					open: { type: 'boolean', label: 'Open at first', default: false },
				},
			},
			// A group of fields edited together.
			more: {
				type: 'object',
				label: 'More help',
				description: 'An optional link below the questions.',
				fields: {
					label: { type: 'text', label: 'Text', maxLength: 60 },
					link: { type: 'link', label: 'Link' },
				},
			},
		},
	}),
	defineComponent({
		type: 'split',
		label: 'Two columns',
		description: 'Two areas side by side (stacked on narrow screens).',
		category: 'Layout',
		component: './src/components/tapestry/Split.astro',
		// Shown in the editor's component library (others get a live preview on hover).
		thumbnail: './src/components/tapestry/thumbnails/split.svg',
		// Named slots: each column holds its own components.
		slots: {
			left: { label: 'Left column' },
			right: { label: 'Right column' },
		},
		props: {
			ratio: {
				type: 'select',
				label: 'Widths',
				options: [
					{ value: 'even', label: 'Equal' },
					{ value: 'wide-left', label: 'Wider left' },
					{ value: 'wide-right', label: 'Wider right' },
				],
				default: 'even',
			},
		},
	}),
	defineComponent({
		type: 'counter',
		label: 'Counter',
		description: 'An interactive counter: a Preact island that loads its JavaScript when it scrolls into view.',
		category: 'Interactive',
		component: './src/components/tapestry/Counter.tsx',
		// Without `client`, it would render as plain HTML with no JavaScript.
		client: 'visible',
		// Version 2 renamed `start` to `initial`; older pages are upgraded by the migration.
		version: 2,
		migrations: './src/components/tapestry/counter.migrations.mjs',
		props: {
			label: { type: 'text', label: 'Label', required: true, maxLength: 60 },
			initial: { type: 'number', label: 'Starts at', default: 0, min: -1000, max: 1000 },
		},
	}),
	defineComponent({
		type: 'columns',
		label: 'Columns',
		description: 'Lays out its children side by side.',
		category: 'Layout',
		component: './src/components/tapestry/Columns.astro',
		acceptsChildren: true,
		props: {
			count: { type: 'number', label: 'Columns', min: 1, max: 4, default: 2 },
		},
	}),
];
