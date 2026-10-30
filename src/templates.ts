/**
 * Templates (ADR 0041): shared header and footer **parts**, and **templates**: page layouts with a
 * body of their own (any components plus named content areas) that pages inherit. Parts and template
 * bodies are documents edited like pages (stored page format, ADR 0011). A page names its template
 * (`template`), or, without one, its own `header`/`footer`. Pure: parsing, validation, areas, merging.
 */
import { pagePath } from './access.js';
import { FULL, modeSlot, nodeModes, parseModeSlot } from './modes.js';
import { parseStoredPage, type StoredPage } from './revisions.js';
import { canonicalNode } from './slots.js';
import type { ComponentManifest, TapestryDocument, TapestryNode } from './types.js';
import { AREA_KEY, PART_ID, TEMPLATE_ID } from './validate.js';

export const REGIONS = ['header', 'footer'] as const;
export type Region = (typeof REGIONS)[number];
export const isRegion = (value: unknown): value is Region => value === 'header' || value === 'footer';

export { AREA_KEY, PART_ID, TEMPLATE_ID };
export const MAX_NAME = 80;
export const MAX_TEMPLATES = 50;
export const MAX_PARTS = 100;

/** The built-in content area component (template editor only). */
export const AREA_TYPE = 'tapestry-area';
/** Prefix of template node ids in a merged document (never selectable or editable on a page). */
export const TEMPLATE_NODE_PREFIX = 'tpl_';

export interface TemplateMeta {
	id: string;
	name: string;
	header: string | null;
	footer: string | null;
}

export interface TemplateRecord extends TemplateMeta {
	/** The template body: draft, published version, history. */
	page: StoredPage;
}

export interface PartMeta {
	id: string;
	region: Region;
	name: string;
}

export interface PartRecord extends PartMeta {
	page: StoredPage;
}

/** A content area of a template: its key (the slot pages use), its name, and its display modes. */
export interface ContentArea {
	key: string;
	name: string;
	/**
	 * The display modes it's shown in (ADR 0046), within its containers' modes, in the order set; absent:
	 * Full only. Pages hold separate content for each (`modeSlot()`).
	 */
	modes?: string[];
}

/** A new id: prefix + 16 lowercase base-36 characters from `random` (crypto in practice). */
export function newId(prefix: 'tt_' | 'tp_', random: (n: number) => Uint8Array): string {
	const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
	return prefix + [...random(16)].map((b) => alphabet[b % 36]).join('');
}

/** A display name: one line, trimmed, capped; empty when unusable. */
export function cleanName(value: unknown): string {
	if (typeof value !== 'string') return '';
	let text = '';
	for (const char of value) text += (char.codePointAt(0) ?? 0) < 0x20 ? ' ' : char;
	return text.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
}

/** A content area's key from its name: `Main content` → `main-content` (empty names → `main`). */
export function areaKey(name: unknown): string {
	const slug = cleanName(name)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '');
	const key = /^[a-z]/.test(slug) ? slug : slug ? `area-${slug}`.slice(0, 40).replace(/-+$/, '') : 'main';
	return AREA_KEY.test(key) ? key : 'main';
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const partRef = (v: unknown) => (typeof v === 'string' && PART_ID.test(v) ? v : null);
const storedPageOf = (raw: unknown, manifest: ComponentManifest, historyLimit: number) =>
	parseStoredPage(typeof raw === 'string' ? raw : JSON.stringify(raw ?? ''), manifest, historyLimit).page;

/** A stored template row (any JSON) → a template with its validated body versions, or null. */
export function parseTemplate(raw: unknown, manifest: ComponentManifest, historyLimit: number): TemplateRecord | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id)) return null;
	const name = cleanName(raw.name);
	if (!name) return null;
	return {
		id: raw.id,
		name,
		header: partRef(raw.header),
		footer: partRef(raw.footer),
		page: storedPageOf(raw.page, manifest, historyLimit),
	};
}

/** A stored part row (any JSON) → a part with its validated document versions, or null. */
export function parsePart(raw: unknown, manifest: ComponentManifest, historyLimit: number): PartRecord | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !PART_ID.test(raw.id) || !isRegion(raw.region)) return null;
	const name = cleanName(raw.name);
	if (!name) return null;
	return { id: raw.id, region: raw.region, name, page: storedPageOf(raw.page, manifest, historyLimit) };
}

/** A part's or template's document as a viewer sees it: the draft for editors previewing, else the published one. */
export function versionFor(record: { page: StoredPage }, preview: boolean): TapestryDocument | null {
	return preview ? (record.page.draft ?? record.page.published) : record.page.published;
}

/** The content areas of a template body, in document order (one per key). */
export function templateAreas(doc: TapestryDocument | null): ContentArea[] {
	const areas: ContentArea[] = [];
	// A node shows only in the modes its containers show in too.
	const walk = (nodes: readonly TapestryNode[], within: readonly string[] | null) => {
		for (const node of nodes) {
			const modes = within ? nodeModes(node).filter((m) => within.includes(m)) : [...nodeModes(node)];
			if (node.type === AREA_TYPE) {
				const key = areaKey(node.props.name);
				if (!areas.some((a) => a.key === key)) {
					const area: ContentArea = { key, name: cleanName(node.props.name) || 'Main' };
					if (!(modes.length === 1 && modes[0] === FULL)) area.modes = modes;
					areas.push(area);
				}
			}
			if (node.children) walk(node.children, modes);
		}
	};
	if (doc) walk(doc.root, null);
	return areas;
}

/**
 * The page rendered inside its template: the template body with each content area holding the
 * page's top-level nodes for that area (their `slot`). Template node ids get the `tpl_` prefix (no
 * collisions with page ids; the canvas never selects them). Page nodes in an area the template
 * doesn't have are left out. Areas' own children in the template are replaced by the page's.
 */
export function mergeTemplate(
	template: TapestryDocument,
	page: TapestryDocument,
	options: {
		/** The display mode to render (ADR 0046): template components not shown in it are left out. */
		mode?: string;
		/** The editor's canvas: the mode each area shows (its tab), by area key; others show `mode`. */
		tabs?: Readonly<Record<string, string>>;
	} = {},
): TapestryDocument {
	const mode = options.mode ?? FULL;
	const byArea = new Map<string, TapestryNode[]>();
	for (const node of page.root) {
		if (node.slot === undefined) continue;
		const { slot: _slot, ...rest } = node;
		byArea.set(node.slot, [...(byArea.get(node.slot) ?? []), canonicalNode(rest)]);
	}
	const used = new Set<string>();
	// Template nodes keep their `modes` (the canvas labels area tabs from them); page nodes never carry any.
	const copy = (nodes: readonly TapestryNode[], within: readonly string[] | null): TapestryNode[] =>
		nodes.flatMap((node) => {
			const id = `${TEMPLATE_NODE_PREFIX}${node.id}`.slice(0, 64);
			const modes = within ? nodeModes(node).filter((m) => within.includes(m)) : [...nodeModes(node)];
			if (node.type === AREA_TYPE) {
				const key = areaKey(node.props.name);
				// The area's tab in the canvas, if it's one of its modes; else the mode being rendered.
				const tab = options.tabs?.[key];
				const shown = tab && modes.includes(tab) ? tab : mode;
				if (!modes.includes(shown)) return [];
				// One area per key gets the content (a duplicate shows empty).
				const children = used.has(key) ? [] : (byArea.get(modeSlot(key, shown)) ?? []);
				used.add(key);
				return [canonicalNode({ ...node, id, children })];
			}
			if (!modes.includes(mode)) return [];
			return [canonicalNode({ ...node, id, ...(node.children ? { children: copy(node.children, modes) } : {}) })];
		});
	return { version: 1, root: copy(template.root, null) };
}

/** Whether a page has anything in `mode`'s content areas of this template (an empty teaser shows a card). */
export function hasModeContent(template: TapestryDocument, page: TapestryDocument, mode: string): boolean {
	const areas = templateAreas(template).filter((a) => (a.modes ?? [FULL]).includes(mode));
	const slots = new Set(areas.map((a) => modeSlot(a.key, mode)));
	return page.root.some((node) => node.slot !== undefined && slots.has(node.slot));
}

/**
 * A page document set to use a template with these areas, or none (its own header and footer):
 * top-level nodes keep their area when the new template has it, else go to the first area; without a
 * template they lose their area. Key order: version, template, header, footer, root.
 */
export function assignAreas(
	doc: TapestryDocument,
	choice: { template: string; areas: readonly ContentArea[] } | { header: string | null; footer: string | null },
): TapestryDocument {
	if ('template' in choice) {
		const keys = new Set(choice.areas.map((a) => a.key));
		const first = choice.areas[0]?.key;
		const root = doc.root.map((node) => {
			// A display mode's content (`main.teaser`, ADR 0046) stays with its area, or moves with it to the
			// first area: a teaser never becomes Full content. It's kept even if the area lacks the mode.
			const parsed = node.slot !== undefined ? parseModeSlot(node.slot) : null;
			if (parsed && keys.has(parsed.area)) return node;
			if (!first) return node;
			return canonicalNode({ ...node, slot: modeSlot(first, parsed?.mode ?? FULL) });
		});
		return { version: 1, template: choice.template, root };
	}
	const root = doc.root.map((node) => {
		if (node.slot === undefined) return node;
		const { slot: _slot, ...rest } = node;
		return canonicalNode(rest);
	});
	return {
		version: 1,
		...(choice.header ? { header: choice.header } : {}),
		...(choice.footer ? { footer: choice.footer } : {}),
		root,
	};
}

/**
 * Why a Template Management action failed: codes in the redirect (never free text, so a crafted link
 * can't put arbitrary words into the dashboard), messages on the page.
 */
export const TEMPLATE_ERRORS = {
	'name-required': 'Give it a name.',
	'part-missing': 'That header or footer no longer exists.',
	'template-missing': 'That template no longer exists.',
	'part-not-found': 'That part no longer exists.',
	'region-required': 'Choose header or footer.',
	'part-in-use': 'A template uses that part. Choose another part in that template first.',
	'confirm-name': 'Pages use that template. Type its name exactly to delete it.',
	'too-many-templates': `A site can have up to ${MAX_TEMPLATES} templates.`,
	'too-many-parts': `A site can have up to ${MAX_PARTS} headers and footers.`,
	unknown: 'Unknown action.',
	failed: 'Saving failed. Please try again.',
} as const;
export type TemplateError = keyof typeof TEMPLATE_ERRORS;

/** A page that uses a template, for Template Management's "Used on" list. */
export interface TemplateUse {
	id: string;
	title: string;
	/** The page's public path. */
	path: string;
	/** Which version uses it: the live one, the unpublished draft, or both. */
	version: 'published' | 'draft' | 'both';
}

/** What `pagesUsingTemplates()` needs of a page. */
export interface UsagePage {
	id: string;
	title: string;
	slug: string;
	package: string;
	content: string;
}

/**
 * The pages using each template (published version or draft), by template id, pages by title (to show
 * the count, list them, and ask before deleting a template in use).
 */
export function pagesUsingTemplates(
	pages: readonly UsagePage[],
	options: { manifest: ComponentManifest; historyLimit: number; pageUrlPattern: string; pageType: string },
): Map<string, TemplateUse[]> {
	const uses = new Map<string, TemplateUse[]>();
	for (const page of pages) {
		if (page.package !== options.pageType || !page.content) continue;
		const stored = parseStoredPage(page.content, options.manifest, options.historyLimit).page;
		const live = stored.published?.template ?? null;
		const draft = stored.draft?.template ?? null;
		for (const id of new Set([live, draft])) {
			if (!id) continue;
			const version = live === id ? (draft === id ? 'both' : 'published') : 'draft';
			const list = uses.get(id) ?? [];
			list.push({
				id: page.id,
				title: page.title || page.slug,
				path: pagePath(options.pageUrlPattern, page.slug),
				version,
			});
			uses.set(id, list);
		}
	}
	for (const list of uses.values()) list.sort((a, b) => a.title.localeCompare(b.title));
	return uses;
}

/** Which templates use a part (to warn before deleting it). */
export const templatesUsing = (partId: string, templates: readonly TemplateMeta[]) =>
	templates.filter((t) => t.header === partId || t.footer === partId);
