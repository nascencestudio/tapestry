/// <reference types="studiocms/v/types" />
/**
 * Stores patterns (patterns.ts) in StudioCMS's plugin data table, one row per
 * pattern (`@nascencestudio/tapestry-pattern:<id>`), through the SDK's database
 * client (StudioCMS 0.6.1's `usePluginData()` can't save; known issue #25).
 * Server only. See ADR 0028.
 */
import { runSDK, SDKCoreJs } from 'studiocms:sdk';
import { type Pattern, parseStoredPattern } from '../patterns.js';
import type { ComponentManifest } from '../types.js';

const PREFIX = '@nascencestudio/tapestry-pattern:';
const rowId = (id: string) => `${PREFIX}${id}`;

/** All patterns, cleaned against the current manifest (unreadable rows are skipped). */
export async function listPatterns(manifest: ComponentManifest): Promise<Pattern[]> {
	// The prefix has no LIKE wildcards (% or _), so a plain prefix match is exact.
	const rows = await SDKCoreJs.dbService.db
		.selectFrom('StudioCMSPluginData')
		.select(['id', 'data'])
		.where('id', 'like', `${PREFIX}%`)
		.execute();
	return rows.flatMap((row) => {
		try {
			const pattern = parseStoredPattern(JSON.parse(row.data), manifest);
			return pattern && rowId(pattern.id) === row.id ? [pattern] : [];
		} catch {
			return [];
		}
	});
}

export async function getPattern(id: string, manifest: ComponentManifest): Promise<Pattern | null> {
	const row = await SDKCoreJs.dbService.db
		.selectFrom('StudioCMSPluginData')
		.select(['id', 'data'])
		.where('id', '=', rowId(id))
		.executeTakeFirst();
	if (!row) return null;
	try {
		const pattern = parseStoredPattern(JSON.parse(row.data), manifest);
		return pattern?.id === id ? pattern : null;
	} catch {
		return null;
	}
}

export async function countPatterns(): Promise<number> {
	const result = await SDKCoreJs.dbService.db
		.selectFrom('StudioCMSPluginData')
		.select((eb) => eb.fn.countAll<number>().as('count'))
		.where('id', 'like', `${PREFIX}%`)
		.executeTakeFirst();
	return Number(result?.count ?? 0);
}

export async function savePattern(pattern: Pattern): Promise<void> {
	await SDKCoreJs.dbService.db
		.insertInto('StudioCMSPluginData')
		.values({ id: rowId(pattern.id), data: JSON.stringify(pattern) })
		.execute();
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}

export async function deletePattern(id: string): Promise<void> {
	await SDKCoreJs.dbService.db.deleteFrom('StudioCMSPluginData').where('id', '=', rowId(id)).execute();
	await runSDK(SDKCoreJs.PLUGINS.clearPluginDataCache()).catch(() => {});
}
