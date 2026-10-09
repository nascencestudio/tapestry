/// <reference types="studiocms/v/types" />
/**
 * Loads and saves admin toolbar settings (toolbar-settings.ts) in StudioCMS's
 * plugin data table (`StudioCMSPluginData`, row `@nascencestudio/tapestry-toolbars`).
 * Server only. See ADR 0014.
 *
 * Reads and writes go straight to the table through the SDK's database client:
 * StudioCMS 0.6.1's `usePluginData()` can't save (its insert and update run
 * through a cache that already holds the pre-write lookup, so the write is
 * skipped; known issue #25). The row id matches what `usePluginData()` would
 * use, so the data stays readable through it.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import { emptyToolbarSettings, parseToolbarSettings, type ToolbarSettings } from '../toolbar-settings.js';
import type { ComponentManifest } from '../types.js';

const ROW_ID = '@nascencestudio/tapestry-toolbars';
/** Where settings lived before the package was renamed (read if the new row doesn't exist yet). */
const LEGACY_ROW_ID = '@tapestry/studiocms-toolbars';

/** The saved settings, cleaned against the current manifest. Errors fall back to no narrowing. */
export async function loadToolbarSettings(manifest: ComponentManifest): Promise<ToolbarSettings> {
	try {
		const rows = await SDKCoreJs.dbService.db
			.selectFrom('StudioCMSPluginData')
			.select(['id', 'data'])
			.where('id', 'in', [ROW_ID, LEGACY_ROW_ID])
			.execute();
		const row = rows.find((r) => r.id === ROW_ID) ?? rows.find((r) => r.id === LEGACY_ROW_ID);
		return row ? parseToolbarSettings(JSON.parse(row.data), manifest) : emptyToolbarSettings();
	} catch (error) {
		console.warn('[tapestry] could not load toolbar settings; using the developer toolbars', error);
		return emptyToolbarSettings();
	}
}

export async function saveToolbarSettings(settings: ToolbarSettings): Promise<void> {
	const data = JSON.stringify(settings);
	await SDKCoreJs.dbService.db.transaction().execute(async (trx) => {
		const existing = await trx
			.selectFrom('StudioCMSPluginData')
			.select('id')
			.where('id', '=', ROW_ID)
			.executeTakeFirst();
		if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', ROW_ID).execute();
		else await trx.insertInto('StudioCMSPluginData').values({ id: ROW_ID, data }).execute();
	});
	// Keep StudioCMS's own plugin-data cache from serving an older copy.
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}
