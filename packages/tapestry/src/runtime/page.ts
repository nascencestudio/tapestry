/// <reference types="studiocms/v/types" />
/**
 * Server helpers for the site's own page routes (imported from `.astro` files
 * via `@nascencestudio/tapestry/page`). They use StudioCMS virtual modules, so they
 * only work inside an Astro request, never in config files.
 */

import { runSDK, SDKCoreJs } from 'studiocms:sdk';
/// <reference path="../virtual.d.ts" />
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import type { AstroGlobal } from 'astro';
import { isEditor, pageAccess, type Viewer } from '../access.js';
import {
	applyDueSchedule,
	documentFor,
	documentForVersion,
	type PageStatus,
	pageStatus,
	parseStoredPage,
	parseVersion,
} from '../revisions.js';
import type { Language } from '../translations.js';
import { emptyDocument } from '../validate.js';
import { CANVAS_PARAM, enableCanvasMode, enableEmbeddedMode, PREVIEW_PARAM, VERSION_PARAM } from './canvas-mode.js';
import { type PageTranslation, pageLanguages } from './languages.js';
import { getViewer } from './viewer.js';

export type { Language, PageTranslation };
export { getViewer };

type RequestContext = Pick<AstroGlobal, 'cookies' | 'params' | 'response' | 'url' | 'locals'>;

export type StudioCMSPage = NonNullable<Awaited<ReturnType<typeof loadPage>>>;

function loadPage(slug: string) {
	return runSDK(SDKCoreJs.GET.page.bySlug(slug));
}

/** Publishing state of a Tapestry page, for the admin bar. */
export interface PublishingInfo {
	status: PageStatus;
	publishedAt: string | null;
	/** True when this response shows the draft (preview or canvas), not the published version. */
	previewing: boolean;
	/** When a scheduled version goes live (ISO 8601), if one is scheduled. */
	scheduledAt: string | null;
}

export interface PageResult {
	page: StudioCMSPage;
	viewer: Viewer;
	/** Only for Tapestry pages. */
	publishing?: PublishingInfo;
	/** The page's language (sites with `languages`): use it for `<html lang>`. */
	language?: Language;
	/**
	 * The page's language versions the viewer may see, including this one (`current`), in
	 * the order of `languages`: for a language switcher and `<link rel="alternate" hreflang>`.
	 */
	translations?: PageTranslation[];
}

const TAPESTRY_PAGE_TYPE = 'tapestry/canvas';

/**
 * Load a StudioCMS page for a public route, enforcing draft visibility.
 *
 * - Returns `null` when the page doesn't exist **or** is a draft and the viewer
 *   isn't an editor. Respond with 404 in both cases, so drafts stay secret.
 * - Sets `Cache-Control: private, no-store` on responses for editors (they may
 *   include the admin bar or draft content) and `X-Robots-Tag: noindex` on drafts.
 * - Turns on canvas mode (markers for the editor's visual canvas) when an
 *   editor requests the page with `?tapestry-canvas`. Ignored for everyone else.
 * - For Tapestry pages, chooses which version to render: visitors always get
 *   the **published** version (never-published pages are a 404 for them);
 *   editors get the unpublished draft with `?tapestry-preview` and in the canvas.
 *
 * @example
 * ```astro
 * ---
 * import { getPage } from '@nascencestudio/tapestry/page';
 * const result = await getPage(Astro);
 * if (!result) return new Response(null, { status: 404 });
 * const { page, viewer } = result;
 * ---
 * ```
 */
export async function getPage(Astro: RequestContext, options: { slug?: string } = {}): Promise<PageResult | null> {
	const slug = options.slug ?? (Astro.params.slug || 'index');
	const [page, viewer] = await Promise.all([loadPage(slug), getViewer(Astro)]);
	if (!page) return null;
	const access = pageAccess(page, viewer);
	if (!access.visible) return null;
	for (const [name, value] of Object.entries(access.headers)) Astro.response.headers.set(name, value);
	const editor = isEditor(viewer);
	const languages = await pageLanguages(Astro.locals, { id: String(page.id), slug: String(page.slug) }, editor);
	const i18n = languages ?? {};
	const canvas = editor && Astro.url.searchParams.has(CANVAS_PARAM);
	if (canvas) {
		enableCanvasMode(Astro.locals);
		Astro.response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	}
	if (page.package !== TAPESTRY_PAGE_TYPE) return { page, viewer, ...i18n };

	// A scheduled version whose time has come is the published one (no background job).
	const stored = applyDueSchedule(
		parseStoredPage(page.defaultContent?.content ?? '', manifest, config.historyLimit).page,
		new Date().toISOString(),
		config.historyLimit,
	);
	// Editors only: a specific version (version comparison in the editor), shown without the admin bar.
	const version = editor ? parseVersion(Astro.url.searchParams.get(VERSION_PARAM)) : null;
	if (version) {
		const doc = documentForVersion(stored, version);
		if (!doc) return null;
		enableEmbeddedMode(Astro.locals);
		Astro.response.headers.set('X-Robots-Tag', 'noindex, nofollow');
		const content = JSON.stringify(doc);
		const rendered = {
			...page,
			defaultContent: page.defaultContent ? { ...page.defaultContent, content } : page.defaultContent,
		} as StudioCMSPage;
		return {
			page: rendered,
			viewer,
			...i18n,
			publishing: {
				status: pageStatus(stored),
				publishedAt: stored.publishedAt,
				previewing: version !== 'published',
				scheduledAt: stored.scheduled?.at ?? null,
			},
		};
	}
	const previewing = editor && (canvas || Astro.url.searchParams.has(PREVIEW_PARAM));
	const chosen = documentFor(stored, { editor, preview: previewing });
	if (!chosen && !editor) return null; // never published: hidden from visitors
	if (previewing) Astro.response.headers.set('X-Robots-Tag', 'noindex, nofollow');
	// Copy, never mutate: StudioCMS caches page objects across requests, and the
	// chosen version (possibly a draft) must not leak into another request.
	const content = JSON.stringify(chosen ?? emptyDocument());
	const rendered = {
		...page,
		defaultContent: page.defaultContent ? { ...page.defaultContent, content } : page.defaultContent,
	} as StudioCMSPage;
	return {
		page: rendered,
		viewer,
		...i18n,
		publishing: {
			status: pageStatus(stored),
			publishedAt: stored.publishedAt,
			previewing,
			scheduledAt: stored.scheduled?.at ?? null,
		},
	};
}
