/// <reference types="studiocms/v/types" />
/**
 * Translation rows (translations.ts) in StudioCMS's plugin data table, through
 * the SDK's database client (known issue #25). Server only. ADR 0032.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import { type LanguageRow, parseLanguageRow, ROW_PREFIX } from '../translations.js';

/** Every translation row, by translated page id. Unreadable rows are skipped. */
export async function loadLanguageRows(): Promise<Map<string, LanguageRow>> {
	// The prefix has no LIKE wildcards (% or _), so a plain prefix match is exact.
	const rows = await SDKCoreJs.dbService.db
		.selectFrom('StudioCMSPluginData')
		.select(['id', 'data'])
		.where('id', 'like', `${ROW_PREFIX}%`)
		.execute();
	const map = new Map<string, LanguageRow>();
	for (const row of rows) {
		try {
			const parsed = parseLanguageRow(JSON.parse(row.data));
			if (parsed) map.set(row.id.slice(ROW_PREFIX.length), parsed);
		} catch {}
	}
	return map;
}

export async function saveLanguageRow(pageId: string, row: LanguageRow): Promise<void> {
	const id = `${ROW_PREFIX}${pageId}`;
	const data = JSON.stringify(row);
	await SDKCoreJs.dbService.db.transaction().execute(async (trx) => {
		const existing = await trx.selectFrom('StudioCMSPluginData').select('id').where('id', '=', id).executeTakeFirst();
		if (existing) await trx.updateTable('StudioCMSPluginData').set({ data }).where('id', '=', id).execute();
		else await trx.insertInto('StudioCMSPluginData').values({ id, data }).execute();
	});
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}
