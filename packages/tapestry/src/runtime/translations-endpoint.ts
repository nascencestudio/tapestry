/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * /_tapestry/translations: a page's language versions, for the editor (ADR 0032).
 * Editors only.
 *
 * - GET `?page=<id>`: the configured languages and the page's translation group
 *   (each member's title, path and publishing status).
 * - POST `{ page, lang }`: create the missing translation: a new Tapestry page
 *   copying the original's settings, slug `<lang>/<slug>`, with the original's
 *   working version as an unpublished draft. Same-origin only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { APIRoute } from 'astro';
import { isEditor, pagePath } from '../access.js';
import { pageStatus, parseStoredPage } from '../revisions.js';
import { PAGE_ID, translationContent, translationGroup, translationSlug, translationTitle } from '../translations.js';
import { loadLanguageRows, saveLanguageRow } from './translations-store.js';
import { getViewer } from './viewer.js';

export const prerender = false;

const TAPESTRY_PAGE_TYPE = 'tapestry/canvas';
const MAX_BODY = 4 * 1024;

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

const loadPage = async (id: string) => {
	try {
		return (await runSDK(SDKCoreJs.GET.page.byId(id))) ?? null;
	} catch {
		return null;
	}
};

export const GET: APIRoute = async (context) => {
	if (!(await editor(context))) return json({ error: 'Editors only' }, 403);
	const pageId = context.url.searchParams.get('page') ?? '';
	if (!PAGE_ID.test(pageId)) return json({ error: 'Not found' }, 404);
	const { languages } = config;
	if (languages.length < 2) return json({ languages, current: null, members: [] });
	try {
		const group = translationGroup(pageId, await loadLanguageRows(), languages);
		const members = (
			await Promise.all(
				group.members.map(async ({ lang, pageId: id }) => {
					const page = await loadPage(id);
					if (!page) return null;
					const stored = parseStoredPage(page.defaultContent?.content ?? '', manifest, config.historyLimit).page;
					return {
						lang,
						pageId: id,
						title: String(page.title ?? ''),
						path: pagePath(config.pageUrlPattern, String(page.slug)),
						status: pageStatus(stored),
						hidden: Boolean(page.draft),
					};
				}),
			)
		).filter((member) => member !== null);
		return json({ languages, current: group.lang, members });
	} catch (error) {
		console.error('[tapestry] loading translations failed', error);
		return json({ error: 'Loading translations failed' }, 500);
	}
};

export const POST: APIRoute = async (context) => {
	if (context.request.headers.get('origin') !== context.url.origin) {
		return json({ error: 'Cross-origin request refused' }, 403);
	}
	const viewer = await editor(context);
	if (!viewer) return json({ error: 'Editors only' }, 403);
	const body = await context.request.text();
	if (body.length > MAX_BODY) return json({ error: 'Too large' }, 413);
	let input: { page?: unknown; lang?: unknown };
	try {
		input = JSON.parse(body);
	} catch {
		return json({ error: 'Expected JSON' }, 400);
	}
	const { languages } = config;
	const language = languages.slice(1).find((l) => l.code === input.lang);
	if (!language) return json({ error: 'Not one of the translation languages' }, 400);
	if (typeof input.page !== 'string' || !PAGE_ID.test(input.page)) return json({ error: 'Not found' }, 404);

	try {
		const rows = await loadLanguageRows();
		const group = translationGroup(input.page, rows, languages);
		const existing = group.members.find((m) => m.lang === language.code);
		if (existing && (await loadPage(existing.pageId))) {
			return json({ error: 'That translation exists', pageId: existing.pageId }, 409);
		}
		const db = SDKCoreJs.dbService.db;
		const sourceRow = await db
			.selectFrom('StudioCMSPageData')
			.selectAll()
			.where('id', '=', group.source)
			.executeTakeFirst();
		const source = sourceRow ? await loadPage(group.source) : null;
		if (!sourceRow || !source || sourceRow.package !== TAPESTRY_PAGE_TYPE) {
			return json({ error: 'The original page is missing or not a Tapestry page' }, 404);
		}

		// A free slug: fr/about, then fr/about-2, …
		const base = translationSlug(String(sourceRow.slug), language.code);
		let slug = base;
		for (
			let n = 2;
			await db.selectFrom('StudioCMSPageData').select('id').where('slug', '=', slug).executeTakeFirst();
			n++
		) {
			slug = `${base}-${n}`;
		}
		const now = new Date().toISOString();
		const id = crypto.randomUUID();
		const stored = parseStoredPage(source.defaultContent?.content ?? '', manifest, config.historyLimit).page;
		await runSDK(
			SDKCoreJs.POST.page({
				pageData: {
					...sourceRow,
					// The SDK's insert schema takes booleans for these (it stores them as 0/1).
					showOnNav: Boolean(sourceRow.showOnNav),
					showAuthor: Boolean(sourceRow.showAuthor),
					showContributors: Boolean(sourceRow.showContributors),
					draft: Boolean(sourceRow.draft),
					id,
					title: translationTitle(String(sourceRow.title), language),
					slug,
					authorId: viewer.user?.id ?? sourceRow.authorId,
					contributorIds: '[]',
					updatedAt: now,
					publishedAt: now,
					contentLang: 'default',
				},
				pageContent: { contentLang: 'default', content: translationContent(stored) },
			} as never),
		);
		await saveLanguageRow(id, { lang: language.code, source: group.source });
		await runSDK(SDKCoreJs.CLEAR.pages).catch(() => {});
		return json({ pageId: id, slug }, 201);
	} catch (error) {
		console.error('[tapestry] creating a translation failed', error);
		return json({ error: 'Creating the translation failed' }, 500);
	}
};
