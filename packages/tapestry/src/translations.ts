/**
 * Translations (ADR 0032). Each language version of a page is its own StudioCMS
 * page (own title, slug and publishing), linked into a translation group: the
 * page in the default language is the group's source, and every translation
 * has a plugin-data row `{ lang, source }` (row id `ROW_PREFIX + pageId`).
 *
 * Pure functions: language options, rows, groups, slugs and titles.
 */
import { emptyStoredPage, type StoredPage, serializeStoredPage, workingDocument } from './revisions.js';

export interface Language {
	/** BCP 47 code, e.g. `en`, `fr`, `pt-BR`. */
	code: string;
	/** Name shown to editors and in language switchers, e.g. "Français". */
	label: string;
}

/** Language codes: a 2–3 letter language, then optional subtags (`pt-BR`, `zh-Hant`). */
const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

/** A language's own name for itself ("français" → "Français"), or the code. */
function nativeName(code: string): string {
	try {
		const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
		if (name && name !== code) return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
	} catch {}
	return code;
}

/**
 * The `languages` option, normalized: `['en', 'fr']` or `[{ code, label }]`.
 * The first is the default language (the pages StudioCMS already has).
 * Throws with a readable message on invalid input.
 */
export function parseLanguages(input: unknown): Language[] {
	if (input === undefined) return [];
	if (!Array.isArray(input)) throw new Error('`languages` must be a list, e.g. ["en", "fr"].');
	const languages = input.map((item): Language => {
		const code = typeof item === 'string' ? item : (item as { code?: unknown })?.code;
		if (typeof code !== 'string' || !LANGUAGE_CODE.test(code)) {
			throw new Error(`\`languages\`: "${String(code)}" is not a language code like "en" or "pt-BR".`);
		}
		const label = typeof item === 'object' && item !== null ? (item as { label?: unknown }).label : undefined;
		if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
			throw new Error(`\`languages\`: the label for "${code}" must be text.`);
		}
		return { code, label: typeof label === 'string' ? label.trim() : nativeName(code) };
	});
	const codes = languages.map((l) => l.code.toLowerCase());
	if (new Set(codes).size !== codes.length) throw new Error('`languages` lists a language more than once.');
	return languages;
}

/** Plugin-data row ids for translations. */
export const ROW_PREFIX = '@nascencestudio/tapestry-language:';

/** A translation's row: its language and the page (in the default language) it translates. */
export interface LanguageRow {
	lang: string;
	source: string;
}

/** Page ids as StudioCMS makes them (UUIDs), and anything id-like. */
export const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseLanguageRow(raw: unknown): LanguageRow | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const { lang, source } = raw as Record<string, unknown>;
	if (typeof lang !== 'string' || !LANGUAGE_CODE.test(lang)) return null;
	if (typeof source !== 'string' || !PAGE_ID.test(source)) return null;
	return { lang, source };
}

export interface GroupMember {
	lang: string;
	pageId: string;
}

/**
 * The translation group a page belongs to, in the order of `languages`: the
 * source page (default language) and the translations of it. Rows for
 * languages that aren't configured (any more) are left out, as are duplicates.
 */
export function translationGroup(
	pageId: string,
	rows: ReadonlyMap<string, LanguageRow>,
	languages: readonly Language[],
): { source: string; lang: string; members: GroupMember[] } {
	const defaultLang = languages[0]?.code ?? '';
	const own = rows.get(pageId);
	const source = own?.source ?? pageId;
	const byLang = new Map<string, string>([[defaultLang, source]]);
	for (const [id, row] of rows) {
		if (row.source !== source || row.lang === defaultLang || byLang.has(row.lang)) continue;
		if (!languages.some((l) => l.code === row.lang)) continue;
		byLang.set(row.lang, id);
	}
	const members = languages.flatMap((l) => {
		const id = byLang.get(l.code);
		return id ? [{ lang: l.code, pageId: id }] : [];
	});
	return { source, lang: own?.lang ?? defaultLang, members };
}

/** Slug for a new translation: `fr` for the home page (`index`), else `fr/<slug>`. */
export function translationSlug(slug: string, lang: string): string {
	return slug === 'index' || slug === '' ? lang.toLowerCase() : `${lang.toLowerCase()}/${slug}`;
}

/** Title for a new translation (to be translated by the editor): "About (Français)". */
export const translationTitle = (title: string, language: Language) => `${title} (${language.label})`;

/**
 * Stored content for a new translation: the source page's working version as
 * an unpublished draft, so visitors see nothing until it's translated and published.
 */
export function translationContent(source: StoredPage | null): string {
	const draft = source ? workingDocument(source) : null;
	return serializeStoredPage({ ...emptyStoredPage(), ...(draft && draft.root.length > 0 ? { draft } : {}) });
}
