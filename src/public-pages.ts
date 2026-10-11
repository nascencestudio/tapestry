/**
 * The pages visitors can see, for sitemaps and other site-wide listings
 * (`listPublicPages()` in `@nascencestudio/tapestry/page`). The same rules as
 * `getPage()`: never a StudioCMS draft; Tapestry pages only once they have a
 * published version (a scheduled version counts once its time has come); and a
 * page's translations only when those are visible too (ADR 0039). Pure functions only.
 */
import { pagePath } from './access.js';
import { applyDueSchedule, parseStoredPage } from './revisions.js';
import { type Language, type LanguageRow, translationGroup } from './translations.js';
import type { ComponentManifest } from './types.js';

const TAPESTRY_PAGE_TYPE = 'tapestry/canvas';

/** A StudioCMS page, reduced to what the listing needs. */
export interface PageRecord {
	id: string;
	slug: string;
	title: string;
	description: string;
	/** The page type (`tapestry/canvas`, `studiocms/markdown`…). */
	package: string;
	draft: boolean;
	/** ISO date of the last change, when known. */
	updatedAt: string | null;
	/** Stored content (Tapestry pages: the stored page with published/draft/history). */
	content: string;
}

export interface PublicPageTranslation {
	lang: string;
	path: string;
}

export interface PublicPage {
	id: string;
	slug: string;
	/** Public path, e.g. `/about` (from the `pageUrlPattern` option). */
	path: string;
	title: string;
	description: string;
	package: string;
	updatedAt: string | null;
	/** The page's language (translated sites), else null. */
	lang: string | null;
	/** All visible language versions including this one (translated sites with more than one visible), else []. */
	translations: PublicPageTranslation[];
}

export interface PublicPageOptions {
	manifest: ComponentManifest;
	historyLimit: number;
	pageUrlPattern: string;
	languages: readonly Language[];
	/** Translation rows by page id (empty on single-language sites). */
	rows: ReadonlyMap<string, LanguageRow>;
	/** ISO date: due schedules count as published from then on. */
	now: string;
}

/** Whether visitors can see a page right now. */
export function isPublicNow(
	page: Pick<PageRecord, 'draft' | 'package' | 'content'>,
	options: Pick<PublicPageOptions, 'manifest' | 'historyLimit' | 'now'>,
): boolean {
	if (page.draft) return false;
	if (page.package !== TAPESTRY_PAGE_TYPE) return true;
	const stored = applyDueSchedule(
		parseStoredPage(page.content, options.manifest, options.historyLimit).page,
		options.now,
		options.historyLimit,
	);
	return stored.published !== null;
}

/** The pages visitors can see, sorted by path, each with its visible translations. */
export function publicPages(pages: readonly PageRecord[], options: PublicPageOptions): PublicPage[] {
	const visible = new Map(pages.filter((page) => isPublicNow(page, options)).map((page) => [page.id, page]));
	const translated = options.languages.length > 1;
	const path = (slug: string) => pagePath(options.pageUrlPattern, slug);
	return [...visible.values()]
		.map((page): PublicPage => {
			let lang: string | null = null;
			let translations: PublicPageTranslation[] = [];
			if (translated) {
				const group = translationGroup(page.id, options.rows, options.languages);
				lang = group.lang;
				const members = group.members.flatMap((member) => {
					const other = visible.get(member.pageId);
					return other ? [{ lang: member.lang, path: path(other.slug) }] : [];
				});
				if (members.length > 1) translations = members;
			}
			return {
				id: page.id,
				slug: page.slug,
				path: path(page.slug),
				title: page.title,
				description: page.description,
				package: page.package,
				updatedAt: page.updatedAt,
				lang,
				translations,
			};
		})
		.sort((a, b) => a.path.localeCompare(b.path));
}
