/**
 * Document migrations (ADR 0031). Two kinds, both applied wherever content is
 * validated (rendering, the editor, clipboard, patterns), so stored pages are
 * upgraded lazily and saved in the new shape the next time they're edited:
 *
 * 1. **Format migrations**: Tapestry's own document format (`version`). Each
 *    entry upgrades a document from `version - 1` to `version`. A document from
 *    a newer format than this code knows is refused, never guessed at.
 * 2. **Component migrations**: a component declares `version: N` and a module of
 *    prop migrations (`{ 2: (props) => …, 3: … }`). Nodes record the version they
 *    were saved with (`version`, only when above 1). `replaces` maps the type
 *    names of renamed components to the new one.
 *
 * Pure functions only; the migration functions come from the developer's
 * modules through `virtual:tapestry/manifest`.
 */
import type { ComponentManifest, ComponentManifestEntry, PropsMigration } from './types.js';

/** The document format this code writes. */
export const CURRENT_FORMAT = 1;

/** A format migration: upgrades a raw document object to the next format version. */
export type FormatMigration = (document: Record<string, unknown>) => Record<string, unknown>;

/**
 * Versions that are never document formats: 2 is the stored page wrapper
 * (`{ version: 2, published, draft, history }`, revisions.ts), and the two share
 * one number space so a stored value is unambiguous. The next format is 3.
 */
export const RESERVED_FORMATS: ReadonlySet<number> = new Set([2]);

/** Format migrations by target version (none yet: format 1 is the first). */
export const FORMAT_MIGRATIONS: Readonly<Record<number, FormatMigration>> = {};

export type FormatResult = { document: Record<string, unknown>; migrated: boolean } | { error: string };

/** Bring a raw document to the current format, or say why it can't be. */
export function migrateFormat(
	input: Record<string, unknown>,
	migrations: Readonly<Record<number, FormatMigration>> = FORMAT_MIGRATIONS,
	current = CURRENT_FORMAT,
): FormatResult {
	const version = input.version;
	if (typeof version !== 'number' || !Number.isInteger(version) || version < 1 || RESERVED_FORMATS.has(version)) {
		return { error: `unsupported document version ${JSON.stringify(version)}` };
	}
	if (version > current) {
		return { error: `document version ${version} is newer than this version of Tapestry supports (${current})` };
	}
	let document = input;
	for (let next = version + 1; next <= current; next++) {
		if (RESERVED_FORMATS.has(next)) continue;
		const migrate = migrations[next];
		if (!migrate) return { error: `no migration to document version ${next}` };
		document = { ...migrate(structuredClone(document)), version: next };
	}
	return { document, migrated: version !== current };
}

/** The component a stored type names: itself, or the component that `replaces` it. */
export function resolveType(manifest: ComponentManifest, type: string): string | undefined {
	if (Object.hasOwn(manifest, type)) return type;
	for (const [name, entry] of Object.entries(manifest)) {
		if (entry.replaces?.includes(type)) return name;
	}
	return undefined;
}

export type ComponentMigrationResult =
	| { props: unknown; version: number; migrated: boolean; warning?: string }
	| { props: unknown; version: number; error: string };

/**
 * Run a component's prop migrations from the version a node was saved with up
 * to the component's current version. Migrations get a copy of the props and
 * must return the new props object. A failing migration keeps the props from
 * before it (validation then cleans them) and reports an error.
 */
export function migrateComponentProps(
	entry: ComponentManifestEntry,
	props: unknown,
	savedVersion: unknown,
): ComponentMigrationResult {
	const current = entry.version ?? 1;
	const from =
		typeof savedVersion === 'number' && Number.isInteger(savedVersion) && savedVersion >= 1 ? savedVersion : 1;
	if (from > current) {
		return {
			props,
			version: current,
			migrated: false,
			warning: `saved with version ${from} of "${entry.type}", newer than the installed version ${current}`,
		};
	}
	let value = props;
	for (let next = from + 1; next <= current; next++) {
		const migrate: PropsMigration | undefined = entry.migrate?.[next];
		if (!migrate) continue; // no prop changes in that version
		try {
			const result = migrate(structuredClone(isRecord(value) ? value : {}));
			if (!isRecord(result)) throw new Error('a migration must return the props object');
			value = result;
		} catch (error) {
			return {
				props: value,
				version: current,
				error: `migrating "${entry.type}" to version ${next} failed: ${(error as Error)?.message ?? error}`,
			};
		}
	}
	return { props: value, version: current, migrated: from !== current };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
