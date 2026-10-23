/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * Pages for lists (ADR 0046), for companions such as Tapestry Fabric: every page visitors can see right
 * now (the rules of `listPublicPages()`), with its categories, tags, template, published date, language
 * group and published document; and a page shown in a display mode. Server only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import { FULL, parseModeSlot } from '../modes.js';
import { type PageRecord, type PublicPage, publicPages } from '../public-pages.js';
import { applyDueSchedule, parseStoredPage } from '../revisions.js';
import { AREA_TYPE, hasModeContent, mergeTemplate, templateAreas, versionFor } from '../templates.js';
import { nodesText } from '../text.js';
import { type LanguageRow, translationGroup } from '../translations.js';
import type { TapestryDocument } from '../types.js';
import { getTemplate } from './templates-store.js';
import { loadLanguageRows } from './translations-store.js';

const TAPESTRY_PAGE_TYPE = 'tapestry/canvas';

export interface ListedTerm {
	id: number;
	name: string;
	/** Categories: the parent category's id, or null. */
	parent: number | null;
}

export interface ListedPage extends PublicPage {
	/** When it was (first) published, ISO 8601: Tapestry's publishing date, else StudioCMS's. */
	publishedAt: string | null;
	categories: ListedTerm[];
	tags: ListedTerm[];
	/** The template it uses (`tt_…`), or null. */
	template: string | null;
	/** Ids of its language versions, itself included (one-language sites: just its own). */
	group: string[];
	/** Tapestry pages: the published document; others: null. */
	document: TapestryDocument | null;
}

interface SdkTerm {
	id?: unknown;
	name?: unknown;
	parent?: unknown;
}

interface SdkPage {
	id: unknown;
	slug: unknown;
	title?: unknown;
	description?: unknown;
	package?: unknown;
	draft?: unknown;
	updatedAt?: unknown;
	publishedAt?: unknown;
	categories?: unknown;
	tags?: unknown;
	defaultContent?: { content?: unknown } | null;
}

const isoDate = (value: unknown): string | null => {
	if (value === null || value === undefined || value === '') return null;
	const date = value instanceof Date ? value : new Date(String(value));
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const terms = (value: unknown): ListedTerm[] =>
	(Array.isArray(value) ? (value as SdkTerm[]) : []).flatMap((term) => {
		const id = Number(term?.id);
		if (!Number.isInteger(id)) return [];
		const parent = term.parent === null || term.parent === undefined ? null : Number(term.parent);
		return [{ id, name: String(term.name ?? ''), parent: Number.isInteger(parent) ? parent : null }];
	});

/** The pages visitors can see right now, for lists (sorted by path; lists sort them themselves). */
export async function listPagesForLists(): Promise<ListedPage[]> {
	const raw = (await runSDK(SDKCoreJs.GET.pages(false, false))) as unknown;
	const sdk = Array.isArray(raw) ? (raw as SdkPage[]) : [];
	const records: PageRecord[] = sdk.map((page) => ({
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
	const now = new Date().toISOString();
	const visible = publicPages(records, {
		manifest,
		historyLimit: config.historyLimit,
		pageUrlPattern: config.pageUrlPattern,
		languages: config.languages,
		rows,
		now,
	});
	const byId = new Map(sdk.map((page) => [String(page.id), page]));
	const recordById = new Map(records.map((record) => [record.id, record]));
	return visible.map((page): ListedPage => {
		const source = byId.get(page.id);
		const record = recordById.get(page.id);
		let document: TapestryDocument | null = null;
		let publishedAt = isoDate(source?.publishedAt);
		if (record?.package === TAPESTRY_PAGE_TYPE) {
			const stored = applyDueSchedule(
				parseStoredPage(record.content, manifest, config.historyLimit).page,
				now,
				config.historyLimit,
			);
			document = stored.published;
			publishedAt = stored.publishedAt ?? publishedAt;
		}
		const group =
			config.languages.length > 1
				? translationGroup(page.id, rows, config.languages).members.map((m) => m.pageId)
				: [page.id];
		return {
			...page,
			publishedAt,
			categories: terms(source?.categories),
			tags: terms(source?.tags),
			template: document?.template ?? null,
			group: group.includes(page.id) ? group : [page.id, ...group],
			document,
		};
	});
}

export interface PageInMode {
	/** What to render: the page inside its template, in the mode (published versions). */
	document: TapestryDocument;
	/**
	 * True when the page has nothing of its own in this mode: its template's areas in the mode are empty
	 * (lists then show a simple card with the trimmed Full text instead).
	 */
	empty: boolean;
}

/**
 * A listed page shown in a display mode, or null when it can't be (not a Tapestry page, its template is
 * gone or has nothing in that mode). Pages without a template are only shown in Full.
 */
export async function pageInMode(page: Pick<ListedPage, 'document'>, mode: string): Promise<PageInMode | null> {
	const doc = page.document;
	if (!doc) return null;
	if (!doc.template) return mode === FULL ? { document: doc, empty: doc.root.length === 0 } : null;
	const template = await getTemplate(doc.template, manifest, config.historyLimit);
	const body = template ? versionFor(template, false) : null;
	if (!body) return null;
	const document = mergeTemplate(body, doc, { mode });
	if (document.root.length === 0) return null;
	const areas = templateAreas(body).filter((a) => (a.modes ?? [FULL]).includes(mode));
	return { document, empty: areas.length > 0 && !hasModeContent(body, doc, mode) };
}

/** A listed page's Full text (its own content, not its template's), for excerpts. Plain text. */
export function pageText(page: Pick<ListedPage, 'document'>): string {
	const doc = page.document;
	if (!doc) return '';
	// Templated pages: the content of each area's Full tab; others: everything.
	const nodes = doc.template
		? doc.root.filter((node) => node.slot !== undefined && parseModeSlot(node.slot)?.mode === FULL)
		: doc.root.filter((node) => node.type !== AREA_TYPE);
	return nodesText(nodes, manifest);
}
