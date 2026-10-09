/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/patterns: the editor's saved sections (ADR 0028). Editors only.
 *
 * - GET: the list (names and descriptions), or `?id=` one pattern with its components.
 * - POST `{ name, nodes }`: save a new pattern (validated against the manifest).
 * - DELETE `?id=`: remove one (its author or an admin).
 *
 * Writes are same-origin only (CSRF) and size-limited.
 */
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { hasPermission, isEditor } from '../access.js';
import { PATTERN_ID, PATTERN_LIMITS, patternFromInput, summarizePattern } from '../patterns.js';
import { countPatterns, deletePattern, getPattern, listPatterns, savePattern } from './patterns-store.js';
import { getViewer } from './viewer.js';

export const prerender = false;

/** Request bodies: the pattern plus JSON overhead. */
const MAX_BODY = PATTERN_LIMITS.maxContentLength * 2;

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

async function editor(context: Context) {
	const viewer = await getViewer(context);
	return isEditor(viewer) ? viewer : null;
}

const sameOrigin = (context: Context) => context.request.headers.get('origin') === context.url.origin;

export const GET: APIRoute = async (context) => {
	const viewer = await editor(context);
	if (!viewer) return json({ error: 'Editors only' }, 403);
	try {
		const id = context.url.searchParams.get('id');
		if (id !== null) {
			if (!PATTERN_ID.test(id)) return json({ error: 'Not found' }, 404);
			const pattern = await getPattern(id, manifest);
			return pattern
				? json({ pattern: { id: pattern.id, name: pattern.name, nodes: pattern.nodes } })
				: json({ error: 'Not found' }, 404);
		}
		const who = { id: viewer.user?.id ?? null, isAdmin: hasPermission(viewer.permissionLevel, 'admin') };
		const patterns = (await listPatterns(manifest))
			.filter((pattern) => pattern.nodes.length > 0)
			.map((pattern) => summarizePattern(pattern, manifest, who))
			.sort((a, b) => a.name.localeCompare(b.name));
		return json({ patterns });
	} catch (error) {
		console.error('[tapestry] loading patterns failed', error);
		return json({ error: 'Loading patterns failed' }, 500);
	}
};

export const POST: APIRoute = async (context) => {
	if (!sameOrigin(context)) return json({ error: 'Cross-origin request refused' }, 403);
	const viewer = await editor(context);
	if (!viewer) return json({ error: 'Editors only' }, 403);
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'Too large' }, 413);
	const body = await context.request.text();
	if (body.length > MAX_BODY) return json({ error: 'Too large' }, 413);
	let input: unknown;
	try {
		input = JSON.parse(body);
	} catch {
		return json({ error: 'Expected JSON' }, 400);
	}
	const result = patternFromInput(
		input,
		manifest,
		{ id: viewer.user?.id ?? null, name: viewer.user?.name ?? null },
		new Date(),
	);
	if ('error' in result) return json({ error: result.error }, result.status);
	try {
		if ((await countPatterns()) >= PATTERN_LIMITS.maxPatterns) {
			return json({ error: `There are already ${PATTERN_LIMITS.maxPatterns} patterns; delete some first` }, 409);
		}
		await savePattern(result.pattern);
	} catch (error) {
		console.error('[tapestry] saving a pattern failed', error);
		return json({ error: 'Saving failed' }, 500);
	}
	const who = { id: viewer.user?.id ?? null, isAdmin: hasPermission(viewer.permissionLevel, 'admin') };
	return json({ pattern: summarizePattern(result.pattern, manifest, who) }, 201);
};

export const DELETE: APIRoute = async (context) => {
	if (!sameOrigin(context)) return json({ error: 'Cross-origin request refused' }, 403);
	const viewer = await editor(context);
	if (!viewer) return json({ error: 'Editors only' }, 403);
	const id = context.url.searchParams.get('id') ?? '';
	if (!PATTERN_ID.test(id)) return json({ error: 'Not found' }, 404);
	try {
		const pattern = await getPattern(id, manifest);
		if (!pattern) return json({ error: 'Not found' }, 404);
		const who = { id: viewer.user?.id ?? null, isAdmin: hasPermission(viewer.permissionLevel, 'admin') };
		if (!summarizePattern(pattern, manifest, who).canDelete) {
			return json({ error: 'Only its author or an admin can delete this pattern' }, 403);
		}
		await deletePattern(id);
		return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
	} catch (error) {
		console.error('[tapestry] deleting a pattern failed', error);
		return json({ error: 'Deleting failed' }, 500);
	}
};
