import type { TapestryDocument, TapestryNode } from './types.js';

/**
 * The custom element Tapestry registers with the StudioCMS component registry
 * for each node; `Node.astro` renders the real component.
 * See docs/decisions/0004-single-wrapper-element.md.
 */
export const NODE_ELEMENT = 'tapestry-node';

/**
 * Wraps a whole document. `Root.astro` renders nothing extra on the public
 * site; in the editor's canvas it marks the region the editor updates live.
 */
export const ROOT_ELEMENT = 'tapestry-root';

/**
 * Wraps the children of one named slot inside a `<tapestry-node>`. Not a
 * registry component: it reaches `Node.astro` as part of the children HTML,
 * where `splitSlots()` takes it apart. See docs/decisions/0027-named-slots.md.
 */
export const SLOT_ELEMENT = 'tapestry-slot';

/** Escape a string for use inside a double-quoted HTML attribute value. */
export function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Encode props for the `props` attribute.
 *
 * StudioCMS's HTML pipeline (ultrahtml) passes attribute values to components
 * without decoding HTML entities, so `&quot;` would reach the component
 * verbatim. `encodeURIComponent` output contains no `"`, `&`, `<` or `>`, so
 * it needs no HTML escaping and survives the pipeline byte-for-byte.
 */
export function encodeProps(props: TapestryNode['props']): string {
	return encodeURIComponent(JSON.stringify(props));
}

/** Inverse of `encodeProps`. Throws on malformed input. */
export function decodeProps(encoded: string): TapestryNode['props'] {
	return JSON.parse(decodeURIComponent(encoded));
}

function renderNode(node: TapestryNode, out: string[]): void {
	out.push(
		'<',
		NODE_ELEMENT,
		' id="',
		escapeAttribute(node.id),
		'" type="',
		escapeAttribute(node.type),
		'" props="',
		encodeProps(node.props),
		'">',
	);
	// Children are grouped by slot (the validator keeps them that way): default area as is,
	// each named slot wrapped once.
	let open: string | undefined;
	for (const child of node.children ?? []) {
		if (child.slot !== open) {
			if (open !== undefined) out.push('</', SLOT_ELEMENT, '>');
			if (child.slot !== undefined) out.push('<', SLOT_ELEMENT, ' name="', escapeAttribute(child.slot), '">');
			open = child.slot;
		}
		renderNode(child, out);
	}
	if (open !== undefined) out.push('</', SLOT_ELEMENT, '>');
	out.push('</', NODE_ELEMENT, '>');
}

/**
 * Render a **validated** document to HTML: a `<tapestry-root>` containing one
 * `<tapestry-node>` per node.
 *
 * ```html
 * <tapestry-root><tapestry-node id="hero-1" type="hero" props="%7B%22heading%22%3A%22Hi%22%7D"></tapestry-node></tapestry-root>
 * ```
 *
 * StudioCMS's component registry swaps the elements for `Root.astro` and
 * `Node.astro`, which render the registered Astro components.
 *
 * Only pass the `document` from `validateDocument()`/`parseDocument()`. The
 * renderer trusts that ids, types and props were checked against the manifest.
 */
export function renderDocument(document: TapestryDocument): string {
	const out: string[] = ['<', ROOT_ELEMENT, '>'];
	for (const node of document.root) {
		renderNode(node, out);
	}
	out.push('</', ROOT_ELEMENT, '>');
	return out.join('');
}

/**
 * Sanitizer options StudioCMS applies to the renderer output before swapping
 * in components. Only Tapestry's two elements are allowed, so nothing else can
 * reach the page even if the renderer has a bug.
 *
 * Note: ultrahtml's `allowAttributes` does not remove unlisted attributes (only
 * `dropAttributes` removes), so attribute safety relies on the validator. See
 * docs/research/studiocms-internals.md.
 */
export const sanitizeOptions = {
	allowElements: [ROOT_ELEMENT, NODE_ELEMENT, SLOT_ELEMENT],
	allowAttributes: { id: [NODE_ELEMENT], type: [NODE_ELEMENT], props: [NODE_ELEMENT], name: [SLOT_ELEMENT] },
	allowComponents: true,
	allowCustomElements: true,
	allowComments: false,
};

/** Slot names as the validator allows them (prop name rules). */
const SLOT_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;
const SLOT_TAG = new RegExp(
	`<${SLOT_ELEMENT}\\s+name=(?:"([^"]*)"|'([^']*)'|([^\\s>]+))\\s*>|</${SLOT_ELEMENT}\\s*>`,
	'gi',
);

/**
 * Split a node's rendered children HTML into its default area and its named
 * slots (`<tapestry-slot name="…">` wrappers from `renderDocument()`).
 *
 * Only top-level wrappers count. The children were rendered by Node.astro,
 * which consumes their own wrappers, and content can't produce the tag (text
 * and attribute values are HTML-escaped). A wrapper with a bad name, or
 * unbalanced tags, are left in the default area as they are.
 */
export function splitSlots(html: string): { main: string; slots: Record<string, string> } {
	const slots: Record<string, string> = Object.create(null);
	let main = '';
	let depth = 0;
	let current: string | null = null;
	let start = 0;
	let last = 0;
	for (const match of html.matchAll(SLOT_TAG)) {
		const at = match.index ?? 0;
		const closing = match[0].startsWith('</');
		if (!closing) {
			const name = match[1] ?? match[2] ?? match[3] ?? '';
			if (depth === 0 && SLOT_NAME.test(name)) {
				main += html.slice(last, at);
				last = at; // if it never closes, the default area keeps it from here
				current = name;
				start = at + match[0].length;
				depth = 1;
			} else if (depth > 0) {
				depth++;
			}
		} else if (depth > 0) {
			depth--;
			if (depth === 0 && current !== null) {
				slots[current] = (slots[current] ?? '') + html.slice(start, at);
				current = null;
				last = at + match[0].length;
			}
		}
	}
	// The rest (or, when a wrapper never closes, everything from it) stays in the default area.
	main += html.slice(last);
	return { main, slots };
}
