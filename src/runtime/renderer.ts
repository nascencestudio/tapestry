/// <reference path="../virtual.d.ts" />

import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { PluginRenderer } from 'studiocms/types';
import { renderDocument, sanitizeOptions } from '../render.js';
import { applyDueSchedule, parseStoredPage } from '../revisions.js';
import { emptyDocument } from '../validate.js';

/**
 * StudioCMS renderer for the `tapestry/canvas` page type.
 *
 * StudioCMS calls `renderer(content)` with the stored page content, sanitizes
 * the returned HTML with `sanitizeOpts`, then swaps each `<tapestry-node>` for
 * `Node.astro`, which renders the real component.
 *
 * Only the **published** version is ever rendered here (never the draft), so
 * routes that skip getPage() can't leak unpublished changes. getPage() passes a
 * single chosen document (format 1), which parses as "published".
 */
const render = {
	name: '@nascencestudio/tapestry',
	renderer: async (content: string) => {
		const parsed = parseStoredPage(content, manifest, config.historyLimit);
		const { issues } = parsed;
		// A scheduled version whose time has come is the published one.
		const page = applyDueSchedule(parsed.page, new Date().toISOString(), config.historyLimit);
		for (const issue of issues) {
			console.warn(`[tapestry] ${issue.severity} at ${issue.path}: ${issue.message}`);
		}
		return renderDocument(page.published ?? emptyDocument());
	},
	sanitizeOpts: sanitizeOptions,
	// Keep the <script>s components render (Astro islands, component scripts). Read by our
	// StudioCMS patch (known issue #37, ADR 0030); safe because Tapestry content can't contain
	// HTML: every script in the output comes from a developer's component.
	componentScripts: true,
} satisfies PluginRenderer & { componentScripts: true };

export default render;
