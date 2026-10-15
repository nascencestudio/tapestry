/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/parts: the content of a header/footer part (`tp_…`) or a template body (`tt_…`), for
 * their editors (ADR 0041). Admins only.
 * - GET `?id=`: `{ id, content }` (the stored page JSON, like a page's content field).
 * - POST `{ id, content }` (JSON, same origin): saves the stored page (draft, publish, history,
 *   schedule). The same rules as page saves apply (save-rules.ts): admins without the publish
 *   permission keep the live version; components locked for their role can't change.
 */
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { hasPermission } from '../access.js';
import { lockedTypes } from '../permissions.js';
import { parseStoredPage } from '../revisions.js';
import { applySaveRules } from '../save-rules.js';
import { PART_ID, TEMPLATE_ID } from '../templates.js';
import { LIMITS } from '../validate.js';
import { getPart, getStoredContent, getTemplate, savePart, saveTemplate } from './templates-store.js';
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

/** The part or template behind an id, or null. */
async function recordFor(id: string) {
	if (PART_ID.test(id)) return getPart(id, manifest, config.historyLimit);
	if (TEMPLATE_ID.test(id)) return getTemplate(id, manifest, config.historyLimit);
	return null;
}

export const GET: APIRoute = async (context) => {
	if (!(await admin(context))) return json({ error: 'Admins only' }, 403);
	const id = context.url.searchParams.get('id') ?? '';
	if (!(await recordFor(id))) return json({ error: 'Not found' }, 404);
	return json({ id, content: (await getStoredContent(id)) ?? '' });
};

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) {
		return json({ error: 'Cross-origin request refused' }, 403);
	}
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
	const record = await recordFor(id);
	if (!record || typeof body.content !== 'string') return json({ error: 'Not found' }, 404);

	const result = applySaveRules(body.content, (await getStoredContent(id)) ?? '', {
		keepPublishing: !hasPermission(viewer.permissionLevel, config.publishPermission),
		locked: lockedTypes(manifest, viewer.permissionLevel),
		manifest,
		historyLimit: config.historyLimit,
	});
	if ('error' in result) return json({ error: result.error }, 403);
	const parsed = parseStoredPage(result.content, manifest, config.historyLimit);
	if (parsed.unreadable) return json({ error: 'The content could not be read.' }, 400);
	try {
		if ('region' in record) await savePart({ ...record, page: parsed.page });
		else await saveTemplate({ ...record, page: parsed.page });
	} catch (error) {
		console.error('[tapestry] saving a part or template failed', error);
		return json({ error: 'Saving failed' }, 500);
	}
	return json({ ok: true, content: (await getStoredContent(id)) ?? '' });
};
