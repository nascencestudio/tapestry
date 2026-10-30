/// <reference types="studiocms/v/types" />
/**
 * Stores templates and parts (templates.ts, ADR 0041) in StudioCMS's plugin data table, through the
 * SDK's database client (StudioCMS 0.6.1's `usePluginData()` can't save; known issue #25):
 * - `@nascencestudio/tapestry-template:<id>`: `{ id, name, header, footer, page }` (`page`: the body);
 * - `@nascencestudio/tapestry-part:<id>`: `{ id, region, name, page }` (`page`: the stored page format).
 * Everything is re-validated on read. Server only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import type { StoredPage } from '../revisions.js';
import {
	type PartRecord,
	pagesUsingTemplates,
	parsePart,
	parseTemplate,
	type TemplateRecord,
	type TemplateUse,
} from '../templates.js';
import type { ComponentManifest } from '../types.js';

const TEMPLATE_PREFIX = '@nascencestudio/tapestry-template:';
const PART_PREFIX = '@nascencestudio/tapestry-part:';

const db = () => SDKCoreJs.dbService.db;
const clearCache = () => runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});

// The prefixes have no LIKE wildcards (% or _), so a plain prefix match is exact.
async function rowsWithPrefix(prefix: string) {
	return db().selectFrom('StudioCMSPluginData').select(['id', 'data']).where('id', 'like', `${prefix}%`).execute();
}

function parseRow<T>(data: string, parse: (raw: unknown) => T | null): T | null {
	try {
		return parse(JSON.parse(data));
	} catch {
		return null;
	}
}

async function upsert(id: string, value: unknown): Promise<void> {
	const data = JSON.stringify(value);
	await db()
		.transaction()
		.execute(async (trx) => {
			const existing = await trx.selectFrom('StudioCMSPluginData').select('id').where('id', '=', id).executeTakeFirst();
			if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', id).execute();
			else await trx.insertInto('StudioCMSPluginData').values({ id, data }).execute();
		});
	await clearCache();
}

async function remove(id: string): Promise<void> {
	await db().deleteFrom('StudioCMSPluginData').where('id', '=', id).execute();
	await clearCache();
}

// Templates

export async function listTemplates(manifest: ComponentManifest, historyLimit: number): Promise<TemplateRecord[]> {
	const rows = await rowsWithPrefix(TEMPLATE_PREFIX);
	return rows
		.flatMap((row) => {
			const template = parseRow(row.data, (raw) => parseTemplate(raw, manifest, historyLimit));
			return template && `${TEMPLATE_PREFIX}${template.id}` === row.id ? [template] : [];
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTemplate(
	id: string,
	manifest: ComponentManifest,
	historyLimit: number,
): Promise<TemplateRecord | null> {
	const row = await db()
		.selectFrom('StudioCMSPluginData')
		.select('data')
		.where('id', '=', `${TEMPLATE_PREFIX}${id}`)
		.executeTakeFirst();
	const template = row ? parseRow(row.data, (raw) => parseTemplate(raw, manifest, historyLimit)) : null;
	return template?.id === id ? template : null;
}

export const saveTemplate = (template: TemplateRecord) => upsert(`${TEMPLATE_PREFIX}${template.id}`, template);
export const deleteTemplate = (id: string) => remove(`${TEMPLATE_PREFIX}${id}`);

// Parts

export async function listParts(manifest: ComponentManifest, historyLimit: number): Promise<PartRecord[]> {
	const rows = await rowsWithPrefix(PART_PREFIX);
	return rows
		.flatMap((row) => {
			const part = parseRow(row.data, (raw) => parsePart(raw, manifest, historyLimit));
			return part && `${PART_PREFIX}${part.id}` === row.id ? [part] : [];
		})
		.sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name));
}

export async function getPart(
	id: string,
	manifest: ComponentManifest,
	historyLimit: number,
): Promise<PartRecord | null> {
	const row = await db()
		.selectFrom('StudioCMSPluginData')
		.select(['id', 'data'])
		.where('id', '=', `${PART_PREFIX}${id}`)
		.executeTakeFirst();
	const part = row ? parseRow(row.data, (raw) => parsePart(raw, manifest, historyLimit)) : null;
	return part?.id === id ? part : null;
}

/** A part's or template's raw stored page JSON (what its editor loads, like a page's content field). */
export async function getStoredContent(id: string): Promise<string | null> {
	const prefix = id.startsWith('tt_') ? TEMPLATE_PREFIX : PART_PREFIX;
	const row = await db()
		.selectFrom('StudioCMSPluginData')
		.select('data')
		.where('id', '=', `${prefix}${id}`)
		.executeTakeFirst();
	const page = row ? parseRow(row.data, (raw) => (raw as { page?: unknown })?.page ?? null) : null;
	return page === null ? null : JSON.stringify(page);
}

export const savePart = (part: { id: string; region: string; name: string; page: StoredPage }) =>
	upsert(`${PART_PREFIX}${part.id}`, part);
export const deletePart = (id: string) => remove(`${PART_PREFIX}${id}`);

/**
 * The pages using each template (published or draft): every page, drafts included, with its content.
 * Throws when the pages can't be read (the delete check then refuses rather than skip the confirmation).
 */
export async function loadTemplateUsage(
	manifest: ComponentManifest,
	historyLimit: number,
	pageUrlPattern: string,
): Promise<Map<string, TemplateUse[]>> {
	const raw = (await runSDK(SDKCoreJs.GET.pages(true, false))) as unknown;
	const pages = (Array.isArray(raw) ? raw : []).map((page: Record<string, unknown>) => ({
		id: String(page.id),
		title: String(page.title ?? ''),
		slug: String(page.slug ?? ''),
		package: String(page.package ?? ''),
		content: String((page.defaultContent as { content?: unknown } | null)?.content ?? ''),
	}));
	return pagesUsingTemplates(pages, { manifest, historyLimit, pageUrlPattern, pageType: 'tapestry/canvas' });
}

/** For Template Management's display: like `loadTemplateUsage()`, but empty (counts of 0) on failure. */
export async function templateUsage(
	manifest: ComponentManifest,
	historyLimit: number,
	pageUrlPattern: string,
): Promise<Map<string, TemplateUse[]>> {
	try {
		return await loadTemplateUsage(manifest, historyLimit, pageUrlPattern);
	} catch (error) {
		console.warn('[tapestry] could not list the pages using templates', error);
		return new Map();
	}
}
