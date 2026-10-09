/**
 * POST /_tapestry/settings: saves the admin toolbar settings form from the
 * dashboard's "Text formatting" page (ToolbarSettings.astro), then redirects
 * back to it. Admins only; same-origin only (CSRF); small bodies only.
 */
/// <reference path="../virtual.d.ts" />
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { hasPermission } from '../access.js';
import { settingsFromForm } from '../toolbar-settings.js';
import { saveToolbarSettings } from './toolbar-store.js';
import { getViewer } from './viewer.js';

export const prerender = false;

const MAX_BODY = 64 * 1024;

const deny = (status: number, message: string) =>
	new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) return deny(403, 'Cross-origin request refused');
	const viewer = await getViewer(context);
	if (!viewer.isLoggedIn || !hasPermission(viewer.permissionLevel, 'admin')) return deny(403, 'Admins only');
	if (Number(context.request.headers.get('content-length') ?? 0) > MAX_BODY) return deny(413, 'Too large');
	const body = await context.request.text();
	if (body.length > MAX_BODY) return deny(413, 'Too large');

	const form = new URLSearchParams(body);
	try {
		await saveToolbarSettings(settingsFromForm(form, manifest));
	} catch (error) {
		console.error('[tapestry] saving toolbar settings failed', error);
		return deny(500, 'Saving failed');
	}

	// Back to the settings page; only same-origin paths are accepted.
	const back = new URL(form.get('return') || '/', context.url);
	const target = back.origin === context.url.origin ? back.pathname : '/';
	return new Response(null, { status: 303, headers: { Location: `${target}?saved=1`, 'Cache-Control': 'no-store' } });
};
