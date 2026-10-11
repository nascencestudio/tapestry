/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * `listPublicPages()`: every page visitors can see right now, with its public path, last
 * change and visible translations (rules in ../public-pages.ts, ADR 0039). For sitemaps and
 * other site-wide listings, e.g. @nascencestudio/tapestry-seo. Server only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import { type PageRecord, type PublicPage, publicPages } from '../public-pages.js';
import type { LanguageRow } from '../translations.js';
import { loadLanguageRows } from './translations-store.js';

export type { PublicPage, PublicPageTranslation } from '../public-pages.js';

interface SdkPage {
	id: unknown;
	slug: unknown;
	title?: unknown;
	description?: unknown;
	package?: unknown;
	draft?: unknown;
	updatedAt?: unknown;
	defaultContent?: { content?: unknown } | null;
}

const isoDate = (value: unknown): string | null => {
	if (value === null || value === undefined || value === '') return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** The pages visitors can see, sorted by path. Drafts and never-published Tapestry pages are left out. */
export async function listPublicPages(): Promise<PublicPage[]> {
	// Non-draft pages, with content (Tapestry pages need it to know whether they're published).
	const raw = (await runSDK(SDKCoreJs.GET.pages(false, false))) as unknown;
	const pages: PageRecord[] = (Array.isArray(raw) ? (raw as SdkPage[]) : []).map((page) => ({
		id: String(page.id),
		slug: String(page.slug),
		title: String(page.title ?? ''),
		description: String(page.description ?? ''),
		package: String(page.package ?? ''),
		draft: Boolean(page.draft),
		updatedAt: isoDate(page.updatedAt),
		content: typeof page.defaultContent?.content === 'string' ? page.defaultContent.content : '',
	}));
	const rows =
		config.languages.length > 1
			? await loadLanguageRows().catch(() => new Map<string, LanguageRow>())
			: new Map<string, LanguageRow>();
	return publicPages(pages, {
		manifest,
		historyLimit: config.historyLimit,
		pageUrlPattern: config.pageUrlPattern,
		languages: config.languages,
		rows,
		now: new Date().toISOString(),
	});
}
