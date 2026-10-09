// @ts-check

import mediaLibrary from '@nascencestudio/medialibrary';
import tapestry, { tapestryComponentRegistry } from '@nascencestudio/tapestry';
import md from '@studiocms/md';
import { defineStudioCMSConfig } from 'studiocms/config';
import { components } from './src/tapestry.config.mjs';

export default defineStudioCMSConfig({
	// First-time setup (/start) only when asked: CMS_SETUP=1 with a fresh database
	// (CI and scripts/setup-site.mjs). Otherwise the setup routes don't exist.
	dbStartPage: process.env.CMS_SETUP === '1',
	features: {
		// Tapestry's server-rendered admin bar replaces StudioCMS's client-side
		// corner menu, which ships an ~18 KB script to every visitor.
		// Note: this must be under `features`; a top-level key is silently ignored.
		// See docs/admin-bar.md.
		injectQuickActionsMenu: false,
		dashboardConfig: {
			// The site has its own 404 page (src/pages/404.astro). StudioCMS's renders the
			// whole dashboard layout for visitors (known issue #34).
			inject404Route: false,
		},
	},
	// Tapestry renders every component through one registered wrapper element.
	componentRegistry: { ...tapestryComponentRegistry() },
	// StudioCMS ships no page types of its own; each comes from a plugin.
	// Markdown (also StudioCMS's hard-coded default in the create form, see
	// docs/known-issues.md #15) and Tapestry. The media library stores uploads in
	// ./data/media (MEDIA_DIR overrides it, e.g. a Docker volume).
	plugins: [
		md(),
		mediaLibrary(),
		tapestry({
			components,
			// Editors can edit and save drafts; publishing (and scheduling) needs an admin or the owner.
			publishPermission: 'admin',
			// Pages can be translated into French: each translation is its own page (slug fr/…).
			languages: ['en', 'fr'],
		}),
	],
});
