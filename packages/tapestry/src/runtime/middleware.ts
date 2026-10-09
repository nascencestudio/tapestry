/**
 * Astro middleware added by the plugin: JSON responses seen by anyone who isn't
 * an editor carry only the *published* version of Tapestry pages, and
 * never-published Tapestry pages are left out (or answered with 404).
 *
 * Matching on the response body rather than on URLs is deliberate: StudioCMS's
 * API router accepts many spellings of the same path (`/pages/`, `//pages`,
 * `%70ages`, `/./pages`, `pages;x`), so a path allowlist would be easy to slip past.
 */
import type { MiddlewareHandler } from 'astro';
import { isEditor } from '../access.js';
import { mayContainDrafts, redactDrafts } from '../public-content.js';
import { guardSaves } from './publish-guard.js';
import { getViewer } from './viewer.js';

const json = (body: unknown, status: number) =>
	new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const onRequest: MiddlewareHandler = async (context, next) => {
	// Saves by people who may not publish keep the live version as stored (see publish-guard.ts).
	const guarded = await guardSaves(context);
	if (guarded instanceof Response) return guarded;
	const response = await (guarded ? next(guarded) : next());
	if (!response.body || !(response.headers.get('content-type') ?? '').includes('json')) return response;

	const text = await response.text();
	const unchanged = () => new Response(text, response);
	if (!mayContainDrafts(text)) return unchanged();
	if (isEditor(await getViewer(context))) return unchanged();

	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return unchanged();
	}
	try {
		const result = redactDrafts(body);
		if (result.hidden) return json({ error: 'Page not found' }, 404);
		const headers = new Headers(response.headers);
		headers.delete('content-length');
		return new Response(JSON.stringify(result.value), {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	} catch (error) {
		// Fail closed: never fall back to the unredacted body.
		console.error('[tapestry] could not redact unpublished content from a JSON response', error);
		return json({ error: 'Internal error' }, 500);
	}
};
