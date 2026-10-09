/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Server-side enforcement of `publishPermission` (who may publish Tapestry
 * pages). Publishing is just saving stored content through StudioCMS's own
 * endpoints, so the editor's disabled Publish button alone proves nothing.
 *
 * For people who may edit but not publish, every JSON save that carries page
 * content for a Tapestry page is rewritten before StudioCMS sees it: the live
 * version, its history and any schedule are taken from the database, and only
 * their working copy is kept, as the draft (`keepPublishingState`). Their
 * drafts save normally; nothing they send can publish, unpublish, schedule or
 * rewrite history. Saves that look like Tapestry content but can't be tied to a
 * page are refused.
 *
 * It also enforces component permissions (ADR 0033): for people below a
 * component's `permission`, every document in the saved page must leave those
 * components as in some version the page already has; otherwise the save is
 * refused (the editor never sends such saves, so only crafted requests hit this).
 *
 * Matching is by body, not URL (StudioCMS's router accepts many spellings of a
 * path). Covered shapes: the dashboard's `{ id, content }` and the REST API's
 * `{ data: { id }, content: { content } }`.
 */

import { SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { APIContext } from 'astro';
import { hasPermission, isEditor } from '../access.js';
import { lockedChanges, lockedMessage, lockedTypes, matchesSomeVersion } from '../permissions.js';
import {
	keepPublishingState,
	looksLikeTapestryContent,
	parseStoredPage,
	type StoredPage,
	workingDocument,
} from '../revisions.js';
import type { TapestryDocument } from '../types.js';
import { getViewer } from './viewer.js';

const PAGE_TYPE = 'tapestry/canvas';
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);
/** Bodies larger than this aren't inspected; they're refused (Tapestry content is far smaller). */
const MAX_BODY = 16 * 1024 * 1024;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const forbid = (message: string) =>
	new Response(JSON.stringify({ error: message }), {
		status: 403,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});

/** Where page content sits in a payload: the dashboard's `content`, or the REST API's `content.content`. */
function contentSlot(payload: Json): { value: unknown; set: (content: string) => void } | null {
	if (typeof payload.content === 'string' || payload.content === null) {
		return { value: payload.content, set: (c) => (payload.content = c) };
	}
	if (isObject(payload.content) && (typeof payload.content.content === 'string' || payload.content.content === null)) {
		const inner = payload.content;
		return { value: inner.content, set: (c) => (inner.content = c) };
	}
	return null;
}

function pageIdOf(payload: Json, url: URL): string | null {
	const data = isObject(payload.data) ? payload.data : {};
	const inner = isObject(payload.content) ? payload.content : {};
	for (const candidate of [payload.id, data.id, inner.contentId]) {
		if (typeof candidate === 'string' && candidate.length <= 128 && candidate) return candidate;
	}
	return UUID.exec(decodeURIComponent(url.pathname))?.[0] ?? null;
}

const packageOf = (payload: Json): unknown =>
	payload.package ?? (isObject(payload.data) ? payload.data.package : undefined);

// biome-ignore lint/suspicious/noExplicitAny: StudioCMS's typed Kysely schema isn't needed for two lookups
const db = (): any => SDKCoreJs.dbService.db;

async function storedPage(id: string): Promise<{ package: string; content: string } | null> {
	const page = await db().selectFrom('StudioCMSPageData').select(['package']).where('id', '=', id).executeTakeFirst();
	if (!page) return null;
	const row = await db()
		.selectFrom('StudioCMSPageContent')
		.select(['content'])
		.where('contentId', '=', id)
		.where('contentLang', '=', 'default')
		.executeTakeFirst();
	return { package: String(page.package), content: typeof row?.content === 'string' ? row.content : '' };
}

/** Every document a stored page holds (the versions locked components may come from). */
function versionsOf(page: StoredPage): TapestryDocument[] {
	return [
		workingDocument(page),
		...(page.published ? [page.published] : []),
		...(page.scheduled ? [page.scheduled.document] : []),
		...page.history.map((entry) => entry.document),
	];
}

/** The documents a save sets: live, working copy, scheduled. */
function documentsOf(page: StoredPage): TapestryDocument[] {
	return [
		workingDocument(page),
		...(page.published ? [page.published] : []),
		...(page.scheduled ? [page.scheduled.document] : []),
	];
}

const anyComponentPermission = Object.values(manifest).some((entry) => (entry.permission ?? 'editor') !== 'editor');

/**
 * Returns a rewritten request (a non-publisher's save keeps the live version)
 * or a 403 response (publishing state or locked components can't be saved
 * like that), or null to let the request through untouched.
 */
export async function guardSaves(context: APIContext): Promise<Request | Response | null> {
	const publishRestricted = config.publishPermission !== 'editor';
	if (!publishRestricted && !anyComponentPermission) return null;
	const { request } = context;
	if (!WRITE_METHODS.has(request.method)) return null;
	if (!(request.headers.get('content-type') ?? '').includes('json')) return null;
	const viewer = await getViewer(context);
	if (!isEditor(viewer)) return null;
	const keepPublishing = publishRestricted && !hasPermission(viewer.permissionLevel, config.publishPermission);
	const locked = anyComponentPermission ? lockedTypes(manifest, viewer.permissionLevel) : new Set<string>();
	if (!keepPublishing && locked.size === 0) return null;

	if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return forbid('Request too large');
	const text = await request.clone().text();
	if (text.length > MAX_BODY) return forbid('Request too large');
	if (!text.includes('content')) return null;
	let payload: unknown;
	try {
		payload = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isObject(payload)) return null;
	const slot = contentSlot(payload);
	if (!slot) return null;

	const id = pageIdOf(payload, new URL(request.url));
	const current = id ? await storedPage(id) : null;
	const tapestry =
		looksLikeTapestryContent(slot.value) || packageOf(payload) === PAGE_TYPE || current?.package === PAGE_TYPE;
	if (!tapestry) return null;
	// A new page (no stored row yet) has no live version to keep; an unknown target is refused.
	if (!current && request.method !== 'POST') {
		return forbid('This content can only be saved to an existing page.');
	}
	let content = typeof slot.value === 'string' ? slot.value : '';
	if (keepPublishing) {
		const merged =
			keepPublishingState(content, current?.content ?? '') ?? keepPublishingState('', current?.content ?? '');
		if (merged === null) return forbid('Only people allowed to publish can save this content.');
		slot.set(merged);
		content = merged;
	}
	if (locked.size > 0) {
		const before = parseStoredPage(current?.content ?? '', manifest, config.historyLimit).page;
		const after = parseStoredPage(content, manifest, config.historyLimit).page;
		const versions = versionsOf(before);
		for (const doc of documentsOf(after)) {
			if (matchesSomeVersion(doc, versions, locked)) continue;
			const [change] = lockedChanges(workingDocument(before), doc, locked);
			return forbid(change ? lockedMessage(change, manifest) : 'This page has components you can’t change.');
		}
	}
	if (!keepPublishing) return null;

	const headers = new Headers(request.headers);
	headers.delete('content-length');
	return new Request(request.url, { method: request.method, headers, body: JSON.stringify(payload) });
}
