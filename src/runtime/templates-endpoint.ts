/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/templates: templates and header/footer parts (ADR 0041).
 * - GET (editors): `{ templates, parts, defaultTemplate }` (the page editor's Template menu; parts
 *   without their documents).
 * - POST (admins, same origin, form fields): the Templates settings page's forms, then back to it.
 *   `action` is one of `create-template`, `update-template`, `delete-template`, `set-default`,
 *   `create-part`, `rename-part`, `delete-part` (refused while a template uses the part).
 */
import { randomBytes } from 'node:crypto';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { hasPermission, isEditor } from '../access.js';
import { emptyStoredPage, pageStatus } from '../revisions.js';
import {
	cleanName,
	isRegion,
	MAX_PARTS,
	MAX_TEMPLATES,
	newId,
	PART_ID,
	TEMPLATE_ID,
	templatesUsing,
} from '../templates.js';
import {
	deletePart,
	deleteTemplate,
	getDefaultTemplate,
	getPart,
	listParts,
	listTemplates,
	savePart,
	saveTemplate,
	setDefaultTemplate,
} from './templates-store.js';
import { getViewer } from './viewer.js';

export const prerender = false;

const MAX_BODY = 16 * 1024;
const random = (n: number) => new Uint8Array(randomBytes(n));

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json',
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff',
		},
	});

const deny = (status: number, message: string) =>
	new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

export const GET: APIRoute = async (context) => {
	if (!isEditor(await getViewer(context))) return json({ error: 'Editors only' }, 403);
	try {
		const [templates, parts, defaultTemplate] = await Promise.all([
			listTemplates(),
			listParts(manifest, config.historyLimit),
			getDefaultTemplate(),
		]);
		return json({
			templates,
			parts: parts.map((p) => ({ id: p.id, region: p.region, name: p.name, status: pageStatus(p.page) })),
			defaultTemplate,
		});
	} catch (error) {
		console.error('[tapestry] loading templates failed', error);
		return json({ error: 'Loading templates failed' }, 500);
	}
};

/** One form action; returns an error message for the page, or null when done. */
async function act(form: URLSearchParams): Promise<string | null> {
	const action = form.get('action');
	const part = (key: string) => {
		const value = form.get(key) ?? '';
		return PART_ID.test(value) ? value : null;
	};
	const id = form.get('id') ?? '';
	const templates = await listTemplates();

	switch (action) {
		case 'create-template':
		case 'update-template': {
			const name = cleanName(form.get('name'));
			if (!name) return 'Give the template a name.';
			const parts = await listParts(manifest, config.historyLimit);
			const header = part('header');
			const footer = part('footer');
			if (header && !parts.some((p) => p.id === header && p.region === 'header'))
				return 'That header no longer exists.';
			if (footer && !parts.some((p) => p.id === footer && p.region === 'footer'))
				return 'That footer no longer exists.';
			if (action === 'create-template') {
				if (templates.length >= MAX_TEMPLATES) return `A site can have up to ${MAX_TEMPLATES} templates.`;
				const created = { id: newId('tt_', random), name, header, footer };
				await saveTemplate(created);
				// The first template becomes the default, so pages pick it up at once.
				if (templates.length === 0) await setDefaultTemplate(created.id);
				return null;
			}
			if (!TEMPLATE_ID.test(id) || !templates.some((t) => t.id === id)) return 'That template no longer exists.';
			await saveTemplate({ id, name, header, footer });
			return null;
		}
		case 'delete-template': {
			if (!TEMPLATE_ID.test(id)) return 'That template no longer exists.';
			await deleteTemplate(id);
			if ((await getDefaultTemplate()) === id) await setDefaultTemplate(null);
			return null;
		}
		case 'set-default': {
			if (id !== '' && !(TEMPLATE_ID.test(id) && templates.some((t) => t.id === id)))
				return 'That template no longer exists.';
			await setDefaultTemplate(id || null);
			return null;
		}
		case 'create-part': {
			const name = cleanName(form.get('name'));
			const region = form.get('region');
			if (!name) return 'Give the part a name.';
			if (!isRegion(region)) return 'Choose header or footer.';
			if ((await listParts(manifest, config.historyLimit)).length >= MAX_PARTS)
				return `A site can have up to ${MAX_PARTS} parts.`;
			await savePart({ id: newId('tp_', random), region, name, page: emptyStoredPage() });
			return null;
		}
		case 'rename-part': {
			const name = cleanName(form.get('name'));
			if (!name) return 'Give the part a name.';
			const existing = PART_ID.test(id) ? await getPart(id, manifest, config.historyLimit) : null;
			if (!existing) return 'That part no longer exists.';
			await savePart({ ...existing, name });
			return null;
		}
		case 'delete-part': {
			if (!PART_ID.test(id)) return 'That part no longer exists.';
			const users = templatesUsing(id, templates);
			if (users.length > 0) {
				return `It’s used by ${users.map((t) => `“${t.name}”`).join(', ')}. Choose another part there first.`;
			}
			await deletePart(id);
			return null;
		}
		default:
			return 'Unknown action.';
	}
}

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) return deny(403, 'Cross-origin request refused');
	const viewer = await getViewer(context);
	if (!viewer.isLoggedIn || !hasPermission(viewer.permissionLevel, 'admin')) return deny(403, 'Admins only');
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY) return deny(413, 'Too large');
	const body = await context.request.text();
	if (body.length > MAX_BODY) return deny(413, 'Too large');
	const form = new URLSearchParams(body);

	let problem: string | null;
	try {
		problem = await act(form);
	} catch (error) {
		console.error('[tapestry] template change failed', error);
		problem = 'Saving failed. Please try again.';
	}
	// Back to the Templates page (same-origin paths only), with the outcome.
	const back = new URL(form.get('return') || '/', context.url);
	const target = new URL(back.origin === context.url.origin ? back.pathname : '/', context.url);
	if (problem) target.searchParams.set('error', problem);
	else target.searchParams.set('saved', '1');
	return new Response(null, {
		status: 303,
		headers: { Location: target.pathname + target.search, 'Cache-Control': 'no-store' },
	});
};
