/**
 * Templates (ADR 0041): shared header and footer **parts**, and **templates**: page layouts with a
 * body of their own (any components plus named content areas) that pages inherit. Parts and template
 * bodies are documents edited like pages (stored page format, ADR 0011). A page names its template
 * (`template`), or, without one, its own `header`/`footer`. Pure: parsing, validation, areas, merging.
 */
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

/** A content area of a template: its key (the slot pages use) and its name. */
export interface ContentArea {
	key: string;
	name: string;
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
	const walk = (nodes: readonly TapestryNode[]) => {
		for (const node of nodes) {
			if (node.type === AREA_TYPE) {
				const key = areaKey(node.props.name);
				if (!areas.some((a) => a.key === key)) areas.push({ key, name: cleanName(node.props.name) || 'Main' });
			}
			if (node.children) walk(node.children);
		}
	};
	if (doc) walk(doc.root);
	return areas;
}

/**
 * The page rendered inside its template: the template body with each content area holding the
 * page's top-level nodes for that area (their `slot`). Template node ids get the `tpl_` prefix (no
 * collisions with page ids; the canvas never selects them). Page nodes in an area the template
 * doesn't have are left out. Areas' own children in the template are replaced by the page's.
 */
export function mergeTemplate(template: TapestryDocument, page: TapestryDocument): TapestryDocument {
	const byArea = new Map<string, TapestryNode[]>();
	for (const node of page.root) {
		if (node.slot === undefined) continue;
		const { slot: _slot, ...rest } = node;
		byArea.set(node.slot, [...(byArea.get(node.slot) ?? []), canonicalNode(rest)]);
	}
	const used = new Set<string>();
	const copy = (nodes: readonly TapestryNode[]): TapestryNode[] =>
		nodes.map((node) => {
			const id = `${TEMPLATE_NODE_PREFIX}${node.id}`.slice(0, 64);
			if (node.type === AREA_TYPE) {
				const key = areaKey(node.props.name);
				// One area per key gets the content (a duplicate shows empty).
				const children = used.has(key) ? [] : (byArea.get(key) ?? []);
				used.add(key);
				return canonicalNode({ ...node, id, children });
			}
			return canonicalNode({ ...node, id, ...(node.children ? { children: copy(node.children) } : {}) });
		});
	return { version: 1, root: copy(template.root) };
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
			if (node.slot !== undefined && keys.has(node.slot)) return node;
			if (!first) return node;
			return canonicalNode({ ...node, slot: first });
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
	'too-many-templates': `A site can have up to ${MAX_TEMPLATES} templates.`,
	'too-many-parts': `A site can have up to ${MAX_PARTS} headers and footers.`,
	unknown: 'Unknown action.',
	failed: 'Saving failed. Please try again.',
} as const;
export type TemplateError = keyof typeof TEMPLATE_ERRORS;

/** Which templates use a part (to warn before deleting it). */
export const templatesUsing = (partId: string, templates: readonly TemplateMeta[]) =>
	templates.filter((t) => t.header === partId || t.footer === partId);
