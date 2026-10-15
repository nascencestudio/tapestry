/**
 * Templates (ADR 0041): shared header and footer **parts**, combined by **templates** that pages
 * choose. Parts are documents edited like pages (stored page format, ADR 0011); a template is a name
 * plus one header part and one footer part. A page's choice is the optional `template` id on its
 * document (missing or unknown: the default template). Pure: parsing, validation, resolution.
 */
import { parseStoredPage, type StoredPage } from './revisions.js';
import type { ComponentManifest, TapestryDocument } from './types.js';
import { TEMPLATE_ID } from './validate.js';

export const REGIONS = ['header', 'footer'] as const;
export type Region = (typeof REGIONS)[number];
export const isRegion = (value: unknown): value is Region => value === 'header' || value === 'footer';

export { TEMPLATE_ID };
export const PART_ID = /^tp_[a-z0-9]{16}$/;
export const MAX_NAME = 80;
export const MAX_TEMPLATES = 50;
export const MAX_PARTS = 100;

export interface TemplateRecord {
	id: string;
	name: string;
	header: string | null;
	footer: string | null;
}

export interface PartMeta {
	id: string;
	region: Region;
	name: string;
}

export interface PartRecord extends PartMeta {
	page: StoredPage;
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

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** A stored template row (any JSON) → a template, or null when it can't be used. */
export function parseTemplate(raw: unknown): TemplateRecord | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !TEMPLATE_ID.test(raw.id)) return null;
	const name = cleanName(raw.name);
	if (!name) return null;
	const part = (v: unknown) => (typeof v === 'string' && PART_ID.test(v) ? v : null);
	return { id: raw.id, name, header: part(raw.header), footer: part(raw.footer) };
}

/** A stored part row (any JSON) → a part with its validated document versions, or null. */
export function parsePart(raw: unknown, manifest: ComponentManifest, historyLimit: number): PartRecord | null {
	if (!isObject(raw) || typeof raw.id !== 'string' || !PART_ID.test(raw.id) || !isRegion(raw.region)) return null;
	const name = cleanName(raw.name);
	if (!name) return null;
	const page = parseStoredPage(
		typeof raw.page === 'string' ? raw.page : JSON.stringify(raw.page ?? ''),
		manifest,
		historyLimit,
	).page;
	return { id: raw.id, region: raw.region, name, page };
}

/** The template a page uses: its own choice if it exists, else the default, else none. */
export function resolveTemplate(
	doc: Pick<TapestryDocument, 'template'> | null,
	templates: readonly TemplateRecord[],
	defaultId: string | null,
): TemplateRecord | null {
	const byId = (id: string | null | undefined) => (id ? (templates.find((t) => t.id === id) ?? null) : null);
	return byId(doc?.template) ?? byId(defaultId);
}

/** A part's document as a viewer sees it: the draft for editors previewing, else the published version. */
export function partDocument(part: Pick<PartRecord, 'page'>, preview: boolean): TapestryDocument | null {
	return preview ? (part.page.draft ?? part.page.published) : part.page.published;
}

/** Which templates use a part (to warn before deleting it). */
export const templatesUsing = (partId: string, templates: readonly TemplateRecord[]) =>
	templates.filter((t) => t.header === partId || t.footer === partId);
