/**
 * Keeps unpublished Tapestry content out of JSON responses for non-editors.
 *
 * A Tapestry page stores its published version, draft and history together
 * (format 2, see revisions.ts). StudioCMS hands stored content out as-is in
 * JSON, most visibly in its anonymous REST API (`/studiocms_api/rest/v1/public/pages`),
 * which has no switch to turn it off. The middleware in runtime/middleware.ts
 * runs these functions over such responses. Pure functions only.
 */

const PAGE_TYPE = 'tapestry/canvas';

/** Cheap pre-check on a raw JSON response body: could it contain Tapestry content? */
export function mayContainDrafts(text: string): boolean {
	return text.includes(PAGE_TYPE) || /\\"version\\"\s*:\s*2/.test(text);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The public form of stored content: the published document as JSON, `''` if
 * the page was never published (or the content can't be read), or `undefined`
 * if this isn't format-2 Tapestry content (left untouched).
 */
export function publicContent(content: string, now: () => number = Date.now): string | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(content);
	} catch {
		return undefined;
	}
	if (!isPlainObject(raw) || raw.version !== 2 || !Array.isArray(raw.history) || !('draft' in raw)) return undefined;
	// A scheduled version is public once its time has come, and never before.
	const scheduled = raw.scheduled;
	if (
		isPlainObject(scheduled) &&
		isPlainObject(scheduled.document) &&
		typeof scheduled.at === 'string' &&
		Date.parse(scheduled.at) <= now()
	) {
		return JSON.stringify(scheduled.document);
	}
	return isPlainObject(raw.published) ? JSON.stringify(raw.published) : '';
}

const HIDDEN = Symbol('hidden');

function redact(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((item) => redact(item)).filter((item) => item !== HIDDEN);
	if (!isPlainObject(value)) return value;

	const page = value.package === PAGE_TYPE;
	const out: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (key === 'content' && typeof child === 'string') {
			const replaced = publicContent(child);
			// Content of a Tapestry page that isn't format 2 is the old single-document
			// format (published by definition) or empty; both are safe as they are.
			out[key] = replaced ?? child;
		} else {
			out[key] = redact(child);
		}
	}
	if (page && isPlainObject(value.defaultContent) && typeof value.defaultContent.content === 'string') {
		const content = value.defaultContent.content;
		if (content.trim() === '' || publicContent(content) === '') return HIDDEN;
	}
	return out;
}

/**
 * Replace stored Tapestry content anywhere in `body` with its published
 * version, and drop never-published Tapestry pages. `hidden` is true when
 * `body` itself is such a page (answer 404).
 */
export function redactDrafts(body: unknown): { value: unknown; hidden: boolean } {
	const value = redact(body);
	return value === HIDDEN ? { value: null, hidden: true } : { value, hidden: false };
}
