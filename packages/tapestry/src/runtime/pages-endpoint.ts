/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * GET /_tapestry/pages: the site's pages for the editor's link picker (id,
 * title, path, draft flag). Editors only; read-only.
 */

import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import type { APIRoute } from 'astro';
import { isEditor, pagePath } from '../access.js';
import { getViewer } from './viewer.js';

export const prerender = false;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});

export interface LinkablePage {
	id: string;
	title: string;
	path: string;
	draft: boolean;
}

export const GET: APIRoute = async (context) => {
	if (!isEditor(await getViewer(context))) return json({ error: 'Editors only' }, 403);
	try {
		const pages = (await runSDK(SDKCoreJs.GET.pages(true, true))) as unknown as Array<{
			id: string;
			title?: string | null;
			slug: string;
			draft?: boolean | null;
		}>;
		const list: LinkablePage[] = (Array.isArray(pages) ? pages : [])
			.map((page) => ({
				id: String(page.id),
				title: String(page.title ?? page.slug),
				path: pagePath(config.pageUrlPattern, String(page.slug)),
				draft: Boolean(page.draft),
			}))
			.sort((a, b) => a.title.localeCompare(b.title));
		return json({ pages: list });
	} catch (error) {
		console.error('[tapestry] listing pages failed', error);
		return json({ error: 'Listing pages failed' }, 500);
	}
};
