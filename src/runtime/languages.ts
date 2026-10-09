/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Translations on the site (ADR 0032): a page's language and the language
 * versions a viewer may see (visitors: published and not a StudioCMS draft;
 * editors: all), and following page links into the current language. Server only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import { pagePath } from '../access.js';
import { applyDueSchedule, parseStoredPage } from '../revisions.js';
import { type Language, type LanguageRow, translationGroup } from '../translations.js';
import { loadLanguageRows } from './translations-store.js';

export interface PageTranslation {
	/** Language code, e.g. `fr` (use for `hreflang` and `lang`). */
	lang: string;
	/** The language's name, e.g. "Français". */
	label: string;
	/** The translation's public path. */
	path: string;
	/** True for the page being shown. */
	current: boolean;
}

const TAPESTRY_PAGE_TYPE = 'tapestry/canvas';
const STATE = Symbol.for('tapestry.languages');

interface RequestState {
	lang: string;
	editor: boolean;
	rows: Promise<Map<string, LanguageRow>>;
}

/** Whether a viewer may see a page: editors always; visitors only published, non-draft pages. */
async function visiblePage(pageId: string, editor: boolean): Promise<{ slug: string } | null> {
	let page: Awaited<ReturnType<typeof loadPage>> = null;
	try {
		page = await loadPage(pageId);
	} catch {}
	if (!page) return null;
	if (editor) return { slug: String(page.slug) };
	if (page.draft) return null;
	if (page.package === TAPESTRY_PAGE_TYPE) {
		const stored = applyDueSchedule(
			parseStoredPage(page.defaultContent?.content ?? '', manifest, config.historyLimit).page,
			new Date().toISOString(),
			config.historyLimit,
		);
		if (!stored.published) return null;
	}
	return { slug: String(page.slug) };
}

const loadPage = async (id: string) => (await runSDK(SDKCoreJs.GET.page.byId(id))) ?? null;

/**
 * The page's language and its visible translations, and remember the language for
 * this request (page links then follow it). Null on single-language sites.
 */
export async function pageLanguages(
	locals: object,
	page: { id: string; slug: string },
	editor: boolean,
): Promise<{ language: Language; translations: PageTranslation[] } | null> {
	const pageId = page.id;
	const { languages } = config;
	if (languages.length < 2) return null;
	const rows = loadLanguageRows().catch(() => new Map<string, LanguageRow>());
	const group = translationGroup(pageId, await rows, languages);
	(locals as Record<symbol, RequestState>)[STATE] = { lang: group.lang, editor, rows };
	const translations = (
		await Promise.all(
			group.members.map(async (member) => {
				const current = member.pageId === pageId;
				const visible = current ? { slug: page.slug } : await visiblePage(member.pageId, editor);
				if (!visible) return null;
				const language = languages.find((l) => l.code === member.lang) as Language;
				return {
					lang: member.lang,
					label: language.label,
					path: pagePath(config.pageUrlPattern, visible.slug),
					current,
				};
			}),
		)
	).filter((t) => t !== null);
	const language = languages.find((l) => l.code === group.lang) ?? (languages[0] as Language);
	return { language, translations };
}

/**
 * For page links on a translated page: the same-language version of a linked
 * page, if there is one the viewer may see (else the page itself). Pages shown
 * without `getPage()` (or on single-language sites) keep their links as they are.
 */
export function localizeFor(locals: object): ((pageId: string) => Promise<string>) | null {
	const state = (locals as Record<symbol, RequestState | undefined>)[STATE];
	if (!state) return null;
	return async (pageId) => {
		const group = translationGroup(pageId, await state.rows, config.languages);
		if (group.lang === state.lang) return pageId;
		const target = group.members.find((m) => m.lang === state.lang);
		if (!target) return pageId;
		return (await visiblePage(target.pageId, state.editor)) ? target.pageId : pageId;
	};
}
