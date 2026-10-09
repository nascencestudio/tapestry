/**
 * Publishing workflow for Tapestry pages: a live **published** version, an
 * optional unpublished **draft**, and a short **history** of earlier published
 * versions. All three live inside the page's stored content (format version 2),
 * so StudioCMS needs no changes. See docs/decisions/0011-draft-publish-history.md.
 *
 * Pure functions only; the editor, renderer and getPage() build on these.
 */
import type { ComponentManifest, TapestryDocument } from './types.js';
import { emptyDocument, LIMITS, type ValidationIssue, validateDocument } from './validate.js';

/** Default number of earlier published versions kept. */
export const DEFAULT_HISTORY_LIMIT = 5;

export interface HistoryEntry {
	document: TapestryDocument;
	/** When this version was published (ISO 8601). */
	publishedAt: string;
	/** Display name of who published it, if known. */
	publishedBy?: string;
}

/** A version waiting to go live at a set time (scheduled publishing). */
export interface ScheduledPublish {
	document: TapestryDocument;
	/** When it goes live (ISO 8601, UTC). */
	at: string;
	/** Display name of who scheduled it, if known. */
	by?: string;
}

/** What a Tapestry page stores (content format version 2). */
export interface StoredPage {
	version: 2;
	/** What visitors see. `null` until the page is first published. */
	published: TapestryDocument | null;
	publishedAt: string | null;
	publishedBy?: string;
	/** Unpublished changes. `null` when the editor matches the published version. */
	draft: TapestryDocument | null;
	/** Earlier published versions, newest first. */
	history: HistoryEntry[];
	/**
	 * A version to publish at a set time. Applied by whoever reads the page once
	 * the time has passed (`applyDueSchedule`); there is no background job.
	 */
	scheduled?: ScheduledPublish | null;
}

export type PageStatus = 'unpublished' | 'published' | 'changed';

export function emptyStoredPage(): StoredPage {
	return { version: 2, published: null, publishedAt: null, draft: null, history: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;
const cleanDate = (value: unknown): string | null => (typeof value === 'string' && ISO_DATE.test(value) ? value : null);
const cleanName = (value: unknown): string | undefined =>
	typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;

export interface StoredPageResult {
	page: StoredPage;
	issues: ValidationIssue[];
	/** True when the content couldn't be read at all (invalid JSON, unknown version). */
	unreadable: boolean;
}

/**
 * Parse stored page content. Accepts:
 * - `""` (a new page): never published, empty draft;
 * - a format-1 document (pages saved before drafts existed): treated as published;
 * - a format-2 stored page.
 * Every document inside is validated against the manifest. Never throws.
 */
export function parseStoredPage(
	content: string,
	manifest: ComponentManifest,
	historyLimit = DEFAULT_HISTORY_LIMIT,
): StoredPageResult {
	if (content.trim() === '') return { page: emptyStoredPage(), issues: [], unreadable: false };
	const maxLength = LIMITS.maxContentLength * (historyLimit + 2);
	const fail = (message: string): StoredPageResult => ({
		page: emptyStoredPage(),
		issues: [{ severity: 'error', path: '$', message }],
		unreadable: true,
	});
	if (content.length > maxLength) return fail(`content exceeds ${maxLength} characters`);

	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch (error) {
		return fail(`invalid JSON: ${(error as Error).message}`);
	}
	if (!isPlainObject(raw)) return fail('content must be a JSON object');

	const issues: ValidationIssue[] = [];
	const doc = (value: unknown, path: string): TapestryDocument | null => {
		if (value === null || value === undefined) return null;
		const result = validateDocument(value, manifest);
		for (const issue of result.issues) issues.push({ ...issue, path: `${path}.${issue.path}` });
		return result.document;
	};

	if (raw.version === 1) {
		const published = doc(raw, 'published');
		return { page: { ...emptyStoredPage(), published }, issues, unreadable: false };
	}
	if (raw.version !== 2) return fail(`unsupported content version ${JSON.stringify(raw.version)}`);

	const history: HistoryEntry[] = [];
	if (Array.isArray(raw.history)) {
		raw.history.slice(0, historyLimit).forEach((entry, index) => {
			if (!isPlainObject(entry)) return;
			const document = doc(entry.document, `history[${index}].document`);
			const publishedAt = cleanDate(entry.publishedAt);
			if (!document || !publishedAt) return;
			const item: HistoryEntry = { document, publishedAt };
			const by = cleanName(entry.publishedBy);
			if (by) item.publishedBy = by;
			history.push(item);
		});
	}
	const page: StoredPage = {
		version: 2,
		published: doc(raw.published, 'published'),
		publishedAt: cleanDate(raw.publishedAt),
		draft: doc(raw.draft, 'draft'),
		history,
	};
	const by = cleanName(raw.publishedBy);
	if (by) page.publishedBy = by;
	if (isPlainObject(raw.scheduled)) {
		const document = doc(raw.scheduled.document, 'scheduled.document');
		const at = cleanDate(raw.scheduled.at);
		if (document && at) {
			page.scheduled = { document, at };
			const scheduledBy = cleanName(raw.scheduled.by);
			if (scheduledBy) page.scheduled.by = scheduledBy;
		}
	}
	return { page, issues, unreadable: false };
}

/** Serialize for storage. */
export function serializeStoredPage(page: StoredPage): string {
	return JSON.stringify(page);
}

/** Structural equality of two documents (they're plain JSON). */
export function sameDocument(a: TapestryDocument | null, b: TapestryDocument | null): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/** The document an editor works on: the draft if there is one, else the published version. */
export function workingDocument(page: StoredPage): TapestryDocument {
	return page.draft ?? page.published ?? emptyDocument();
}

export function pageStatus(page: StoredPage): PageStatus {
	if (!page.published) return 'unpublished';
	return page.draft && !sameDocument(page.draft, page.published) ? 'changed' : 'published';
}

/** Store `doc` as the draft (or clear the draft if it matches what's published). */
export function saveDraft(page: StoredPage, doc: TapestryDocument): StoredPage {
	if (page.published && sameDocument(doc, page.published)) return { ...page, draft: null };
	return { ...page, draft: doc };
}

/**
 * Publish `doc` (default: the working document). The previous published version
 * moves to the front of the history, which is capped at `historyLimit`.
 */
export function publish(
	page: StoredPage,
	options: { doc?: TapestryDocument; now: string; by?: string; historyLimit?: number },
): StoredPage {
	const doc = options.doc ?? workingDocument(page);
	const limit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
	if (page.published && sameDocument(doc, page.published)) return { ...page, draft: null };
	const history = page.published
		? [
				{
					document: page.published,
					publishedAt: page.publishedAt ?? options.now,
					...(page.publishedBy ? { publishedBy: page.publishedBy } : {}),
				},
				...page.history,
			]
		: page.history;
	const next: StoredPage = {
		version: 2,
		published: doc,
		publishedAt: options.now,
		draft: null,
		history: history.slice(0, Math.max(0, limit)),
	};
	if (options.by) next.publishedBy = options.by;
	return next;
}

/** Throw away unpublished changes. */
export function discardDraft(page: StoredPage): StoredPage {
	return { ...page, draft: null };
}

/** Load a history entry into the draft (nothing goes live until it's published). */
export function restoreToDraft(page: StoredPage, index: number): StoredPage {
	const entry = page.history[index];
	return entry ? saveDraft(page, entry.document) : page;
}

/** Schedule `doc` (default: the working document) to go live at `at` (ISO 8601). The draft stays as it is. */
export function schedulePublish(
	page: StoredPage,
	options: { doc?: TapestryDocument; at: string; by?: string },
): StoredPage {
	const scheduled: ScheduledPublish = { document: options.doc ?? workingDocument(page), at: options.at };
	if (options.by) scheduled.by = options.by;
	return { ...page, scheduled };
}

/** Cancel a scheduled publish. */
export function cancelSchedule(page: StoredPage): StoredPage {
	const { scheduled: _scheduled, ...rest } = page;
	return rest;
}

/**
 * If the scheduled time has passed, the page as it is after that publish: the
 * scheduled version is live (published at the scheduled time, by whoever
 * scheduled it), the previous one is in history, and a draft identical to it
 * is cleared (other drafts stay). Otherwise the page unchanged.
 *
 * Every reader applies this (renderer, getPage, public JSON, the editor), so
 * the page goes live on time without a background job; the stored content
 * catches up on the next save.
 */
export function applyDueSchedule(page: StoredPage, now: string, historyLimit = DEFAULT_HISTORY_LIMIT): StoredPage {
	const scheduled = page.scheduled;
	if (!scheduled || Date.parse(scheduled.at) > Date.parse(now)) return page;
	const published = publish(cancelSchedule(page), {
		doc: scheduled.document,
		now: scheduled.at,
		...(scheduled.by ? { by: scheduled.by } : {}),
		historyLimit,
	});
	const draft = page.draft && !sameDocument(page.draft, scheduled.document) ? page.draft : null;
	return { ...published, draft };
}

/** A version of a page: the live one, the draft (working copy), or an earlier published one. */
export type PageVersion = 'published' | 'draft' | `history-${number}`;

/** A `tapestry-version` value, or null if it isn't one. */
export function parseVersion(value: string | null | undefined): PageVersion | null {
	if (value === 'published' || value === 'draft') return value;
	return value && /^history-(?:0|[1-9]\d?)$/.test(value) ? (value as PageVersion) : null;
}

/** The document of a version, or null if it doesn't exist (e.g. a history entry beyond the list). */
export function documentForVersion(page: StoredPage, version: PageVersion): TapestryDocument | null {
	if (version === 'published') return page.published;
	if (version === 'draft') return workingDocument(page);
	return page.history[Number(version.slice('history-'.length))]?.document ?? null;
}

/** Which document a request should render. */
export function documentFor(page: StoredPage, view: { editor: boolean; preview: boolean }): TapestryDocument | null {
	if (view.editor && view.preview) return workingDocument(page);
	return page.published;
}

/**
 * For saves by someone who may edit but not publish: the stored content with
 * the publishing state (live version, its date and author, history, schedule)
 * taken from `currentContent` (what's stored now), and the incoming working
 * copy kept as the draft. Works on raw JSON (no manifest): documents are
 * validated whenever they're read. Returns null if `incomingContent` isn't
 * Tapestry content in a known format.
 */
export function keepPublishingState(incomingContent: string, currentContent: string): string | null {
	const parse = (text: string): Record<string, unknown> | null => {
		if (text.trim() === '') return {};
		try {
			const value = JSON.parse(text);
			return isPlainObject(value) ? value : null;
		} catch {
			return null;
		}
	};
	const incoming = parse(incomingContent);
	if (!incoming) return null;
	const current = parse(currentContent) ?? {};
	// The incoming working copy: a format-2 page's draft (or its published version), or a format-1 document.
	let working: unknown;
	if (incoming.version === 2) working = incoming.draft ?? incoming.published ?? null;
	else if (incoming.version === 1) working = incoming;
	else if (Object.keys(incoming).length === 0) working = null;
	else return null;
	// The current publishing state: a format-1 document counts as published.
	const currentPublished = current.version === 1 ? current : current.version === 2 ? (current.published ?? null) : null;
	const next: Record<string, unknown> = {
		version: 2,
		published: currentPublished,
		publishedAt: current.version === 2 ? (current.publishedAt ?? null) : null,
		draft: working && JSON.stringify(working) !== JSON.stringify(currentPublished) ? working : null,
		history: current.version === 2 && Array.isArray(current.history) ? current.history : [],
	};
	if (current.version === 2 && typeof current.publishedBy === 'string') next.publishedBy = current.publishedBy;
	if (current.version === 2 && isPlainObject(current.scheduled)) next.scheduled = current.scheduled;
	return JSON.stringify(next);
}

/**
 * True if `content` looks like Tapestry content: a stored page (format 2) or a
 * single document (format 1, which renders as published). Either can carry a
 * publishing change.
 */
export function looksLikeTapestryContent(content: unknown): content is string {
	if (typeof content !== 'string' || !content.includes('"version"')) return false;
	try {
		const value = JSON.parse(content);
		if (!isPlainObject(value)) return false;
		if (value.version === 2) return 'draft' in value || 'published' in value;
		return value.version === 1 && Array.isArray(value.root);
	} catch {
		return false;
	}
}
