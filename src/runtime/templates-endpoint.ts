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
	type TemplateError,
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

/** One form action; returns an error code for the page (TEMPLATE_ERRORS), or null when done. */
async function act(form: URLSearchParams): Promise<TemplateError | null> {
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
			if (!name) return 'name-required';
			const parts = await listParts(manifest, config.historyLimit);
			const header = part('header');
			const footer = part('footer');
			if (header && !parts.some((p) => p.id === header && p.region === 'header')) return 'part-missing';
			if (footer && !parts.some((p) => p.id === footer && p.region === 'footer')) return 'part-missing';
			if (action === 'create-template') {
				if (templates.length >= MAX_TEMPLATES) return 'too-many-templates';
				const created = { id: newId('tt_', random), name, header, footer };
				await saveTemplate(created);
				// The first template becomes the default, so pages pick it up at once.
				if (templates.length === 0) await setDefaultTemplate(created.id);
				return null;
			}
			if (!TEMPLATE_ID.test(id) || !templates.some((t) => t.id === id)) return 'template-missing';
			await saveTemplate({ id, name, header, footer });
			return null;
		}
		case 'delete-template': {
			if (!TEMPLATE_ID.test(id)) return 'template-missing';
			await deleteTemplate(id);
			if ((await getDefaultTemplate()) === id) await setDefaultTemplate(null);
			return null;
		}
		case 'set-default': {
			if (id !== '' && !(TEMPLATE_ID.test(id) && templates.some((t) => t.id === id))) return 'template-missing';
			await setDefaultTemplate(id || null);
			return null;
		}
		case 'create-part': {
			const name = cleanName(form.get('name'));
			const region = form.get('region');
			if (!name) return 'name-required';
			if (!isRegion(region)) return 'region-required';
			if ((await listParts(manifest, config.historyLimit)).length >= MAX_PARTS) return 'too-many-parts';
			await savePart({ id: newId('tp_', random), region, name, page: emptyStoredPage() });
			return null;
		}
		case 'rename-part': {
			const name = cleanName(form.get('name'));
			if (!name) return 'name-required';
			const existing = PART_ID.test(id) ? await getPart(id, manifest, config.historyLimit) : null;
			if (!existing) return 'part-not-found';
			await savePart({ ...existing, name });
			return null;
		}
		case 'delete-part': {
			if (!PART_ID.test(id)) return 'part-not-found';
			if (templatesUsing(id, templates).length > 0) return 'part-in-use';
			await deletePart(id);
			return null;
		}
		default:
			return 'unknown';
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

	let problem: TemplateError | null;
	try {
		problem = await act(form);
	} catch (error) {
		console.error('[tapestry] template change failed', error);
		problem = 'failed';
	}
	// Back to the Templates page (same-origin addresses only), with the outcome.
	const back = new URL(form.get('return') || '/', context.url);
	const target = new URL(back.origin === context.url.origin ? back.pathname + back.search : '/', context.url);
	target.searchParams.delete('saved');
	target.searchParams.delete('error');
	if (problem) target.searchParams.set('error', problem);
	else target.searchParams.set('saved', '1');
	return new Response(null, {
		status: 303,
		headers: { Location: target.pathname + target.search, 'Cache-Control': 'no-store' },
	});
};
