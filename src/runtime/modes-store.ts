/// <reference types="studiocms/v/types" />
/// <reference path="../virtual.d.ts" />
/**
 * The site's display modes (ADR 0046) in StudioCMS's plugin data table (row
 * `@nascencestudio/tapestry-display-modes`, through the SDK's database client like toolbar-store.ts:
 * known issue #25). Only the added modes are stored; Full and Teaser are built in. Off (no modes at all)
 * unless a companion turns display modes on (`config.displayModes`: Tapestry Fabric installed). Server only.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import config from 'virtual:tapestry/config';
import manifest from 'virtual:tapestry/manifest';
import {
	cleanModeName,
	type DisplayMode,
	isBuiltInMode,
	MAX_MODES,
	modeClassName,
	modeKeyFor,
	modeUsage,
	parseModes,
	storedModes,
	withoutMode,
} from '../modes.js';
import type { StoredPage } from '../revisions.js';
import type { TapestryDocument } from '../types.js';
import { listTemplates, saveTemplate } from './templates-store.js';

export type { DisplayMode } from '../modes.js';
export { BUILT_IN_MODES, FULL, isBuiltInMode, MAX_MODES, MODE_NAME_MAX, modeClassName, TEASER } from '../modes.js';

const ROW_ID = '@nascencestudio/tapestry-display-modes';

/** Whether display modes are on for this site. */
export const displayModesEnabled = (): boolean => config.displayModes;

/** The site's modes (Full, Teaser, then the added ones), or none when display modes are off. */
export async function loadModes(): Promise<DisplayMode[]> {
	if (!config.displayModes) return [];
	try {
		const row = await SDKCoreJs.dbService.db
			.selectFrom('StudioCMSPluginData')
			.select('data')
			.where('id', '=', ROW_ID)
			.executeTakeFirst();
		return parseModes(row ? JSON.parse(row.data) : null);
	} catch (error) {
		console.warn('[tapestry] could not load display modes; using Full and Teaser', error);
		return parseModes(null);
	}
}

async function saveModes(modes: readonly DisplayMode[]): Promise<void> {
	const data = JSON.stringify(storedModes(modes));
	await SDKCoreJs.dbService.db.transaction().execute(async (trx) => {
		const existing = await trx
			.selectFrom('StudioCMSPluginData')
			.select('id')
			.where('id', '=', ROW_ID)
			.executeTakeFirst();
		if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', ROW_ID).execute();
		else await trx.insertInto('StudioCMSPluginData').values({ id: ROW_ID, data }).execute();
	});
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}

/** Why a change to the modes was refused (codes, like Template Management's). */
export type ModeError = 'off' | 'name-required' | 'name-taken' | 'too-many' | 'not-found' | 'built-in';

/** Two names that read the same or would give the same CSS class (`Big card`, `big-card`). */
const sameName = (a: string, b: string) =>
	a.toLowerCase() === b.toLowerCase() || (modeClassName(a) !== '' && modeClassName(a) === modeClassName(b));

/** Add a mode; its key comes from the name and never changes. */
export async function addMode(name: unknown): Promise<{ mode: DisplayMode } | { error: ModeError }> {
	if (!config.displayModes) return { error: 'off' };
	const clean = cleanModeName(name);
	if (!clean) return { error: 'name-required' };
	const modes = await loadModes();
	if (modes.length >= MAX_MODES) return { error: 'too-many' };
	if (modes.some((m) => sameName(m.name, clean))) return { error: 'name-taken' };
	const key = modeKeyFor(clean, new Set(modes.map((m) => m.key)));
	if (!key) return { error: 'too-many' };
	const mode = { key, name: clean };
	await saveModes([...modes, mode]);
	return { mode };
}

/** Rename an added mode (Full and Teaser keep their names). */
export async function renameMode(key: string, name: unknown): Promise<{ mode: DisplayMode } | { error: ModeError }> {
	if (!config.displayModes) return { error: 'off' };
	if (isBuiltInMode(key)) return { error: 'built-in' };
	const clean = cleanModeName(name);
	if (!clean) return { error: 'name-required' };
	const modes = await loadModes();
	if (!modes.some((m) => m.key === key)) return { error: 'not-found' };
	if (modes.some((m) => m.key !== key && sameName(m.name, clean))) return { error: 'name-taken' };
	await saveModes(modes.map((m) => (m.key === key ? { key, name: clean } : m)));
	return { mode: { key, name: clean } };
}

const mapStored = (page: StoredPage, fn: (doc: TapestryDocument) => TapestryDocument): StoredPage => ({
	...page,
	published: page.published && fn(page.published),
	draft: page.draft && fn(page.draft),
	history: page.history.map((entry) => ({ ...entry, document: fn(entry.document) })),
	...(page.scheduled ? { scheduled: { ...page.scheduled, document: fn(page.scheduled.document) } } : {}),
});

/**
 * Delete an added mode: it's taken off every template component (those left without one show in Full
 * again). Pages' content for it is kept but no longer shown (ADR 0046).
 */
export async function deleteMode(key: string): Promise<{ ok: true } | { error: ModeError }> {
	if (!config.displayModes) return { error: 'off' };
	if (isBuiltInMode(key)) return { error: 'built-in' };
	const modes = await loadModes();
	if (!modes.some((m) => m.key === key)) return { error: 'not-found' };
	for (const template of await listTemplates(manifest, config.historyLimit)) {
		const page = mapStored(template.page, (doc) => withoutMode(doc, key));
		if (JSON.stringify(page) !== JSON.stringify(template.page)) await saveTemplate({ ...template, page });
	}
	await saveModes(modes.filter((m) => m.key !== key));
	return { ok: true };
}

/** Where each mode is used: components shown in it and templates with any, from the templates' latest versions. */
export async function loadModeUsage(): Promise<Map<string, { components: number; templates: number }>> {
	const templates = await listTemplates(manifest, config.historyLimit);
	return modeUsage(templates.map((t) => t.page.draft ?? t.page.published));
}

/** The templates as choices (`{ value: id, label: name }`), sorted by name: for companions' template pickers. */
export async function listTemplateChoices(): Promise<Array<{ value: string; label: string }>> {
	const templates = await listTemplates(manifest, config.historyLimit);
	return templates
		.map((t) => ({ value: t.id, label: t.name }))
		.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
}
