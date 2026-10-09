// @ts-check
import node from '@astrojs/node';
import preact from '@astrojs/preact';
import { defineConfig } from 'astro/config';
import studioCMS from 'studiocms';

// The public URL. In production (Docker) it's passed at build time; Astro then
// trusts the reverse proxy's X-Forwarded-Host/Proto for this host only, so
// Astro.url (and the same-origin checks) see https://your-domain.
const siteUrl = new URL(process.env.SITE_URL || 'http://localhost:4321');

export default defineConfig({
	site: siteUrl.origin,
	security: {
		allowedDomains: [{ hostname: siteUrl.hostname, protocol: siteUrl.protocol.replace(':', '') }],
	},
	// StudioCMS requires on-demand rendering.
	output: 'server',
	adapter: node({ mode: 'standalone' }),
	// Preact for interactive Tapestry components (islands, ADR 0030); public pages without one ship no JS.
	integrations: [preact(), studioCMS()],
	vite: {
		build: {
			// Workaround: StudioCMS's ComponentRegistryUI.astro (0.6.0 and 0.6.1)
			// nests @keyframes inside a rule, which Vite 8's default lightningcss
			// minifier rejects. Any site using `componentRegistry` hits this.
			// See docs/known-issues.md.
			cssMinify: 'esbuild',
		},
	},
});
