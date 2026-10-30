/**
 * Child areas of a component: its default area (`acceptsChildren`) and its
 * named slots. A node's `slot` names the area it's in (absent = default).
 * Children are kept grouped by area in this order, so a parent's children
 * array reads like the page. Pure functions; used by the validator, the
 * renderer and the editor.
 */
import type { ComponentManifest, ComponentManifestEntry, TapestryNode } from './types.js';

/**
 * Manifest key describing the document root when a page uses a template (ADR 0041): its slots are
 * the template's content areas. Not a component type (types are kebab-case), so it never renders.
 */
export const ROOT_ENTRY = '#root';

/** A template content area's key (its name, slugified): the `slot` of a page's top-level nodes. */
export const AREA_KEY = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * The manifest with the root's areas set (a page using a template), or removed (`null`). With display
 * modes (ADR 0046), an area shown in several modes has a slot per mode: `main` (Full), `main.teaser`
 * ("Main · Teaser"), in the site's mode order; an area in one mode keeps just its key.
 */
export function withRootAreas(
	manifest: ComponentManifest,
	areas: ReadonlyArray<{ key: string; name: string; modes?: readonly string[] }> | null,
	modes: ReadonlyArray<{ key: string; name: string }> = [],
): ComponentManifest {
	const { [ROOT_ENTRY]: _old, ...rest } = manifest;
	if (!areas || areas.length === 0) return rest;
	const slots = Object.fromEntries(
		areas.flatMap((area) => {
			const shown = modes.filter((m) => (area.modes ?? ['full']).includes(m.key));
			if (shown.length <= 1) return [[area.key, { label: area.name }]];
			// `modeSlot()` in modes.ts (which imports this module): Full is the bare key.
			return shown.map((m) => [
				m.key === 'full' ? area.key : `${area.key}.${m.key}`,
				{ label: `${area.name} · ${m.name}` },
			]);
		}),
	);
	return {
		...rest,
		[ROOT_ENTRY]: { type: ROOT_ENTRY, label: 'Page', component: '', props: {}, slots } as ComponentManifestEntry,
	};
}

/** An area: a slot name, or `undefined` for the default area. */
export type Area = string | undefined;

/** The component's areas in display order (default first, if it has one). */
export function childAreas(entry: ComponentManifestEntry | undefined): Area[] {
	if (!entry) return [];
	const named = Object.keys(entry.slots ?? {});
	return entry.acceptsChildren ? [undefined, ...named] : named;
}

/** Whether the component can hold children at all. */
export const hasChildAreas = (entry: ComponentManifestEntry | undefined): boolean => childAreas(entry).length > 0;

/** Whether `area` is one of the component's areas. */
export function hasArea(entry: ComponentManifestEntry | undefined, area: Area): boolean {
	if (!entry) return false;
	return area === undefined ? Boolean(entry.acceptsChildren) : Object.hasOwn(entry.slots ?? {}, area);
}

/** The area new children go to when none is chosen: default, else the first slot. */
export const firstArea = (entry: ComponentManifestEntry | undefined): Area => childAreas(entry)[0];

/** Display name of an area. */
export function areaLabel(entry: ComponentManifestEntry | undefined, area: Area): string {
	if (area === undefined) return entry?.label ?? 'Container';
	return entry?.slots?.[area]?.label ?? area;
}

/** Children in canonical order: grouped by area (stable within each area). */
export function sortByArea(children: TapestryNode[], entry: ComponentManifestEntry | undefined): TapestryNode[] {
	if (!entry?.slots) return children;
	const areas = childAreas(entry);
	const rank = (node: TapestryNode) => {
		const at = areas.indexOf(node.slot);
		return at === -1 ? areas.length : at;
	};
	const sorted = children
		.map((node, index) => ({ node, index, rank: rank(node) }))
		.sort((a, b) => a.rank - b.rank || a.index - b.index)
		.map((entry) => entry.node);
	return sorted.every((node, i) => node === children[i]) ? children : sorted;
}

/**
 * A node object in canonical key order (id, type, version, label, slot, modes, props, children):
 * documents are compared as strings.
 */
export function canonicalNode(node: TapestryNode): TapestryNode {
	return {
		id: node.id,
		type: node.type,
		...(node.version !== undefined && node.version > 1 ? { version: node.version } : {}),
		...(node.label ? { label: node.label } : {}),
		...(node.slot !== undefined ? { slot: node.slot } : {}),
		...(node.modes && node.modes.length > 0 ? { modes: node.modes } : {}),
		props: node.props,
		...(node.children ? { children: node.children } : {}),
	};
}
