/**
 * Display modes (ADR 0046): how a page is shown. `full` is the page itself, `teaser` a card in a list,
 * and admins add more (Tapestry Fabric's Display Modes page). Template components say which modes they're
 * shown in (`node.modes`); a content area in several modes holds separate content per mode, stored as
 * root slots `area` (Full) and `area.mode`. Inert until a companion turns modes on (`config.displayModes`).
 * Pure functions.
 */
import { AREA_KEY, canonicalNode } from './slots.js';
import type { TapestryDocument, TapestryNode } from './types.js';

export interface DisplayMode {
	/** Never changes once created: stored in templates and pages. */
	key: string;
	name: string;
}

export const MODE_KEY = /^[a-z][a-z0-9-]{0,31}$/;
export const FULL = 'full';
export const TEASER = 'teaser';
/** Full and Teaser always exist and can't be renamed or deleted (the user's choice). */
export const BUILT_IN_MODES: readonly DisplayMode[] = [
	{ key: FULL, name: 'Full' },
	{ key: TEASER, name: 'Teaser' },
];
/** Built-ins included. */
export const MAX_MODES = 16;
export const MODE_NAME_MAX = 40;

export const isBuiltInMode = (key: string): boolean => BUILT_IN_MODES.some((m) => m.key === key);

/** A mode's name from user input: one line, trimmed, at most `MODE_NAME_MAX` characters. */
export function cleanModeName(value: unknown): string {
	if (typeof value !== 'string') return '';
	// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
	const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ');
	return text.replace(/\s+/g, ' ').trim().slice(0, MODE_NAME_MAX).trim();
}

/**
 * A mode's CSS class suffix, from its current **name** (`Big card` → `big-card`), so renaming a mode renames
 * its classes (lists' `fabric-list--big-card`). Its key never changes (it's stored in templates and pages).
 * Names whose classes would be the same are refused (`addMode`, `renameMode`).
 */
export function modeClassName(name: string): string {
	return cleanModeName(name)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/** A key for a new mode from its name (`Search result` → `search-result`), unique among `taken`. */
export function modeKeyFor(name: string, taken: ReadonlySet<string>): string | null {
	const slug = cleanModeName(name)
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 28)
		.replace(/-+$/, '');
	const base = /^[a-z]/.test(slug) ? slug : slug ? `mode-${slug}`.slice(0, 28).replace(/-+$/, '') : 'mode';
	for (let n = 1; n < 1000; n++) {
		const key = n === 1 ? base : `${base}-${n}`;
		if (MODE_KEY.test(key) && !taken.has(key)) return key;
	}
	return null;
}

/**
 * The site's modes from stored data (any JSON): the built-ins first, then valid added modes in their
 * stored order (unique keys, named, at most `MAX_MODES` in all).
 */
export function parseModes(raw: unknown): DisplayMode[] {
	const modes: DisplayMode[] = [...BUILT_IN_MODES];
	const list =
		raw && typeof raw === 'object' && Array.isArray((raw as { modes?: unknown }).modes)
			? (raw as { modes: unknown[] }).modes
			: [];
	for (const item of list) {
		if (modes.length >= MAX_MODES) break;
		if (!item || typeof item !== 'object') continue;
		const { key, name } = item as { key?: unknown; name?: unknown };
		const clean = cleanModeName(name);
		if (typeof key !== 'string' || !MODE_KEY.test(key) || !clean) continue;
		if (modes.some((m) => m.key === key)) continue;
		modes.push({ key, name: clean });
	}
	return modes;
}

/** What's stored: only the added modes (the built-ins are implied). */
export const storedModes = (modes: readonly DisplayMode[]) => ({
	version: 1,
	modes: modes.filter((m) => !isBuiltInMode(m.key)).map(({ key, name }) => ({ key, name })),
});

/**
 * A node's modes, validated: unique mode keys in the order given, at most `MAX_MODES`. `undefined` when
 * absent, invalid or exactly the default (Full only), so the default is never stored.
 */
export function cleanNodeModes(raw: unknown): string[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const keys: string[] = [];
	for (const item of raw) {
		if (typeof item !== 'string' || !MODE_KEY.test(item) || keys.includes(item)) continue;
		if (keys.length >= MAX_MODES) break;
		keys.push(item);
	}
	if (keys.length === 0) return undefined;
	if (keys.length === 1 && keys[0] === FULL) return undefined;
	return keys;
}

/** The modes a node is shown in (absent: Full only). */
export const nodeModes = (node: Pick<TapestryNode, 'modes'>): readonly string[] => node.modes ?? [FULL];

/** Whether a node is shown in `mode`. */
export const shownIn = (node: Pick<TapestryNode, 'modes'>, mode: string): boolean => nodeModes(node).includes(mode);

/** The root slot holding an area's content for a mode: `main` (Full), `main.teaser`. */
export const modeSlot = (area: string, mode: string): string => (mode === FULL ? area : `${area}.${mode}`);

/** A root slot's area and mode (`main.teaser` → main, teaser), or null if it isn't one. */
export function parseModeSlot(slot: string): { area: string; mode: string } | null {
	const dot = slot.indexOf('.');
	const area = dot === -1 ? slot : slot.slice(0, dot);
	const mode = dot === -1 ? FULL : slot.slice(dot + 1);
	if (!AREA_KEY.test(area) || !MODE_KEY.test(mode)) return null;
	if (dot !== -1 && mode === FULL) return null; // Full is the bare area key, never `area.full`
	return { area, mode };
}

/** The modes, in the site's order, of those listed in `keys` that still exist. */
export const knownModes = (keys: readonly string[], modes: readonly DisplayMode[]): DisplayMode[] =>
	modes.filter((m) => keys.includes(m.key));

/** How often each mode is used in template bodies: components shown in it, and templates with any. */
export function modeUsage(
	bodies: ReadonlyArray<TapestryDocument | null>,
): Map<string, { components: number; templates: number }> {
	const usage = new Map<string, { components: number; templates: number }>();
	for (const body of bodies) {
		if (!body) continue;
		const counts = new Map<string, number>();
		const walk = (nodes: readonly TapestryNode[]) => {
			for (const node of nodes) {
				for (const mode of nodeModes(node)) counts.set(mode, (counts.get(mode) ?? 0) + 1);
				if (node.children) walk(node.children);
			}
		};
		walk(body.root);
		for (const [mode, components] of counts) {
			const total = usage.get(mode) ?? { components: 0, templates: 0 };
			usage.set(mode, { components: total.components + components, templates: total.templates + 1 });
		}
	}
	return usage;
}

/**
 * A template body without mode `key` on any component; a component left with no mode is shown in Full
 * again (the default). Returns the same object when nothing changed.
 */
export function withoutMode(doc: TapestryDocument, key: string): TapestryDocument {
	let changed = false;
	const strip = (nodes: TapestryNode[]): TapestryNode[] =>
		nodes.map((node) => {
			let next = node;
			if (node.modes?.includes(key)) {
				changed = true;
				const modes = cleanNodeModes(node.modes.filter((m) => m !== key));
				const { modes: _old, ...rest } = node;
				next = canonicalNode(modes ? { ...rest, modes } : rest);
			}
			if (next.children) {
				const children = strip(next.children);
				if (children !== next.children) next = { ...next, children };
			}
			return next;
		});
	const root = strip(doc.root);
	return changed ? { ...doc, root } : doc;
}

/** Canvas tabs from `area:mode,area:mode` (the `tapestry-tabs` parameter): valid pairs only, at most 50. */
export function parseTabs(value: string | null | undefined): Record<string, string> {
	const tabs: Record<string, string> = {};
	if (!value) return tabs;
	for (const pair of value.split(',').slice(0, 50)) {
		const [area, mode, extra] = pair.split(':');
		if (extra === undefined && area && mode && AREA_KEY.test(area) && MODE_KEY.test(mode)) tabs[area] = mode;
	}
	return tabs;
}

/** The `tapestry-tabs` value for tabs (Full tabs are the default and left out). */
export const tabsParam = (tabs: Readonly<Record<string, string>>): string =>
	Object.entries(tabs)
		.filter(([, mode]) => mode !== FULL)
		.map(([area, mode]) => `${area}:${mode}`)
		.join(',');
