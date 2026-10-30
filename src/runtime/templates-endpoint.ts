/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/templates: templates and header/footer parts (ADR 0041).
 * - GET (editors): `{ templates, parts }` for the page editor's Template menu: templates with their
 *   header, footer and content areas (from the published body, else the draft); parts without their
 *   documents.
 * - POST (admins, same origin, form fields): Template Management's forms, then back to the page.
 *   `action`: `create-template`, `update-template` (name, header, footer), `delete-template`,
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
	templateAreas,
	templatesUsing,
} from '../templates.js';
import {
	deletePart,
	deleteTemplate,
	getPart,
	getTemplate,
	listParts,
	listTemplates,
	loadTemplateUsage,
	savePart,
	saveTemplate,
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
		const [templates, parts] = await Promise.all([
			listTemplates(manifest, config.historyLimit),
			listParts(manifest, config.historyLimit),
		]);
		return json({
			templates: templates.map((t) => ({
				id: t.id,
				name: t.name,
				header: t.header,
				footer: t.footer,
				areas: templateAreas(t.page.published ?? t.page.draft),
				status: pageStatus(t.page),
			})),
			parts: parts.map((p) => ({ id: p.id, region: p.region, name: p.name, status: pageStatus(p.page) })),
		});
	} catch (error) {
		console.error('[tapestry] loading templates failed', error);
		return json({ error: 'Loading templates failed' }, 500);
	}
};

/** One form action; returns an error code for the page (TEMPLATE_ERRORS), or null when done. */
async function act(form: URLSearchParams): Promise<TemplateError | null> {
	const action = form.get('action');
	const id = form.get('id') ?? '';
	const partField = (key: string) => {
		const value = form.get(key) ?? '';
		return PART_ID.test(value) ? value : null;
	};

	switch (action) {
		case 'create-template':
		case 'update-template': {
			const name = cleanName(form.get('name'));
			if (!name) return 'name-required';
			const parts = await listParts(manifest, config.historyLimit);
			const header = partField('header');
			const footer = partField('footer');
			if (header && !parts.some((p) => p.id === header && p.region === 'header')) return 'part-missing';
			if (footer && !parts.some((p) => p.id === footer && p.region === 'footer')) return 'part-missing';
			if (action === 'create-template') {
				const templates = await listTemplates(manifest, config.historyLimit);
				if (templates.length >= MAX_TEMPLATES) return 'too-many-templates';
				await saveTemplate({ id: newId('tt_', random), name, header, footer, page: emptyStoredPage() });
				return null;
			}
			const existing = TEMPLATE_ID.test(id) ? await getTemplate(id, manifest, config.historyLimit) : null;
			if (!existing) return 'template-missing';
			await saveTemplate({ ...existing, name, header, footer });
			return null;
		}
		case 'delete-template': {
			if (!TEMPLATE_ID.test(id)) return 'template-missing';
			const existing = await getTemplate(id, manifest, config.historyLimit);
			if (!existing) return 'template-missing';
			// In use: the name must be typed to confirm (the dialog asks; checked here too). Pages using it
			// then render without a template (their content stays in the document).
			const uses = (await loadTemplateUsage(manifest, config.historyLimit, config.pageUrlPattern)).get(id) ?? [];
			if (uses.length > 0 && form.get('confirm') !== existing.name) return 'confirm-name';
			await deleteTemplate(id);
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
			if (templatesUsing(id, await listTemplates(manifest, config.historyLimit)).length > 0) return 'part-in-use';
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
	// Back to the page the form was on (same-origin addresses only), with the outcome.
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
