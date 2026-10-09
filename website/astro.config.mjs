// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// GitHub Pages: DOCS_SITE (https://<owner>.github.io) and DOCS_BASE (/<repo>) come from the
// deploy workflow; REPO_URL adds the GitHub link. Locally: http://localhost:4321/.
const repoUrl = process.env.REPO_URL;

export default defineConfig({
	site: process.env.DOCS_SITE || 'http://localhost:4321',
	base: process.env.DOCS_BASE || '/',
	integrations: [
		starlight({
			title: 'Tapestry',
			description: 'Drag-and-drop, component-based page building for Astro + StudioCMS.',
			social: repoUrl ? [{ icon: 'github', label: 'GitHub', href: repoUrl }] : [],
			sidebar: [
				{ label: 'Start here', items: [{ autogenerate: { directory: 'start' } }] },
				{ label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
				{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
				{ label: 'Project', items: [{ autogenerate: { directory: 'project' } }] },
				{ label: 'Decisions (ADRs)', collapsed: true, items: [{ autogenerate: { directory: 'decisions' } }] },
			],
		}),
	],
});
