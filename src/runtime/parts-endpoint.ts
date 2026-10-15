/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/parts: a header or footer part's content for the part editor (ADR 0041). Admins only.
 * - GET `?id=`: `{ part: { id, region, name }, content }` (the stored page JSON, like a page's field).
 * - POST `{ id, content }` (JSON, same origin): saves the part's stored page (draft, publish,
 *   history, schedule). The same rules as page saves apply (save-rules.ts): admins without the
 *   publish permission keep the live version; components locked for their role can't change.
 */
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { hasPermission } from '../access.js';
import { lockedTypes } from '../permissions.js';
import { parseStoredPage } from '../revisions.js';
import { applySaveRules } from '../save-rules.js';
import { PART_ID } from '../templates.js';
import { LIMITS } from '../validate.js';
import { getPart, getPartContent, savePart } from './templates-store.js';
import { getViewer } from './viewer.js';

export const prerender = false;

const MAX_BODY = LIMITS.maxContentLength * (config.historyLimit + 3);

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});

type Context = Parameters<APIRoute>[0];

async function admin(context: Context) {
	const viewer = await getViewer(context);
	return viewer.isLoggedIn && hasPermission(viewer.permissionLevel, 'admin') ? viewer : null;
}

export const GET: APIRoute = async (context) => {
	if (!(await admin(context))) return json({ error: 'Admins only' }, 403);
	const id = context.url.searchParams.get('id') ?? '';
	const part = PART_ID.test(id) ? await getPart(id, manifest, config.historyLimit) : null;
	if (!part) return json({ error: 'Not found' }, 404);
	return json({
		part: { id: part.id, region: part.region, name: part.name },
		content: (await getPartContent(id)) ?? '',
	});
};

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin)
		return json({ error: 'Cross-origin request refused' }, 403);
	const viewer = await admin(context);
	if (!viewer) return json({ error: 'Admins only' }, 403);
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Too large' }, 413);
	const text = await context.request.text();
	if (text.length > MAX_BODY) return json({ error: 'Too large' }, 413);
	let body: { id?: unknown; content?: unknown };
	try {
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Expected JSON' }, 400);
	}
	const id = typeof body.id === 'string' ? body.id : '';
	const part = PART_ID.test(id) ? await getPart(id, manifest, config.historyLimit) : null;
	if (!part || typeof body.content !== 'string') return json({ error: 'Not found' }, 404);

	const current = (await getPartContent(id)) ?? '';
	const result = applySaveRules(body.content, current, {
		keepPublishing: !hasPermission(viewer.permissionLevel, config.publishPermission),
		locked: lockedTypes(manifest, viewer.permissionLevel),
		manifest,
		historyLimit: config.historyLimit,
	});
	if ('error' in result) return json({ error: result.error }, 403);
	const parsed = parseStoredPage(result.content, manifest, config.historyLimit);
	if (parsed.unreadable) return json({ error: 'The content could not be read.' }, 400);
	try {
		await savePart({ id: part.id, region: part.region, name: part.name, page: parsed.page });
	} catch (error) {
		console.error('[tapestry] saving a part failed', error);
		return json({ error: 'Saving failed' }, 500);
	}
	return json({ ok: true, content: (await getPartContent(id)) ?? '' });
};
