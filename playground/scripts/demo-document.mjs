// The demo Tapestry document used by `pnpm seed` and the e2e test.
// Deliberately includes characters that must survive HTML encoding intact.
export const demoDocument = {
	version: 1,
	root: [
		{
			id: 'hero-1',
			type: 'hero',
			props: {
				heading: 'Pages built from "real" Astro components & nothing else',
				subheading: 'This page is a Tapestry JSON document rendered by StudioCMS. <b>Tags</b> stay text. 🎉',
				ctaLabel: 'Open the dashboard',
				ctaHref: '/dashboard',
				align: 'center',
			},
		},
		{
			id: 'section-1',
			type: 'section',
			props: { background: 'muted', width: 'wide' },
			children: [
				{ id: 'heading-1', type: 'heading', props: { text: 'How it works', level: '2' } },
				{
					id: 'columns-1',
					type: 'columns',
					props: { count: 3 },
					children: [
						{
							id: 'text-1',
							type: 'text',
							props: { body: 'Developers register Astro components with a typed prop schema.' },
						},
						{
							id: 'text-2',
							type: 'text',
							props: { body: 'Editors arrange them into a tree.\n\nThe tree is stored as JSON.' },
						},
						{
							id: 'text-3',
							type: 'text',
							props: {
								body: {
									type: 'doc',
									content: [
										{
											type: 'paragraph',
											content: [
												{ type: 'text', text: 'StudioCMS renders the tree ' },
												{ type: 'text', text: 'server-side', marks: [{ type: 'bold' }] },
												{ type: 'text', text: '. Zero client JS by ' },
												{ type: 'text', text: 'default', marks: [{ type: 'link', attrs: { href: '/#how-it-works' } }] },
												{ type: 'text', text: '.' },
											],
										},
									],
								},
							},
						},
					],
				},
			],
		},
		{
			id: 'section-2',
			type: 'section',
			props: { width: 'narrow' },
			children: [
				{
					id: 'button-1',
					type: 'button',
					props: {
						label: 'Read the docs',
						href: { type: 'url', url: 'https://docs.studiocms.dev', newTab: true },
						variant: 'secondary',
					},
				},
			],
		},
	],
};
