/**
 * Canvas mode: a per-request flag that makes `Root.astro` and `Node.astro`
 * emit the invisible markers the editor's visual canvas needs. Only set by
 * `getPage()` (for editors who request `?tapestry-canvas`) and by the
 * editors-only render endpoint, so public visitors never get markers.
 */

/** Query parameter the editor adds to the page URL it loads in the canvas iframe. */
export const CANVAS_PARAM = 'tapestry-canvas';

/** Query parameter for editors to preview a page's unpublished draft on the site. */
export const PREVIEW_PARAM = 'tapestry-preview';

/**
 * Query parameter for editors to view a specific version on the site:
 * `published`, `draft` or `history-N` (N = 0 for the newest earlier version).
 * Used by the editor's version comparison, which shows it without the admin bar.
 */
export const VERSION_PARAM = 'tapestry-version';

/** Attribute on each node's wrapper in canvas mode; value is the node id. */
export const NODE_ATTR = 'data-tapestry-node';

/**
 * Attributes on the wrapper around each child area of a component with named
 * slots, in canvas mode: the owning node's id, and the slot name ('' for the
 * default area).
 */
export const SLOT_OF_ATTR = 'data-tapestry-slot-of';
export const SLOT_ATTR = 'data-tapestry-slot';

/** Attribute on the document root wrapper in canvas mode. */
export const ROOT_ATTR = 'data-tapestry-root';

/** Attributes on the wrapper around a rich text prop's output in canvas mode (node id, prop name). */
export const TEXT_ATTR = 'data-tapestry-text';
export const TEXT_PROP_ATTR = 'data-tapestry-prop';

const FLAG = Symbol.for('tapestry.canvas');
const OWNERS = Symbol.for('tapestry.canvas.owners');

type Locals = object;

export function enableCanvasMode(locals: Locals): void {
	(locals as Record<symbol, unknown>)[FLAG] = true;
}

export function isCanvasMode(locals: Locals | undefined): boolean {
	return Boolean(locals && (locals as Record<symbol, unknown>)[FLAG]);
}

const EMBEDDED = Symbol.for('tapestry.embedded');

/** Mark the request as shown inside the editor (no admin bar), without canvas markers. */
export function enableEmbeddedMode(locals: Locals): void {
	(locals as Record<symbol, unknown>)[EMBEDDED] = true;
}

/** True in canvas mode or when embedded in the editor (e.g. version comparison). */
export function isEmbedded(locals: Locals | undefined): boolean {
	return isCanvasMode(locals) || Boolean(locals && (locals as Record<symbol, unknown>)[EMBEDDED]);
}

type Owners = WeakMap<object, { nodeId: string; prop: string }>;

/**
 * Remember which node and prop an object prop value (rich text) belongs to, so
 * `RichText.astro` can mark its output for inline editing. Canvas mode only.
 */
export function registerPropOwner(locals: Locals, value: unknown, nodeId: string, prop: string): void {
	if (typeof value !== 'object' || value === null) return;
	const bag = locals as Record<symbol, unknown>;
	bag[OWNERS] ??= new WeakMap();
	const owners = bag[OWNERS] as Owners;
	owners.set(value, { nodeId, prop });
}

export function propOwner(locals: Locals | undefined, value: unknown): { nodeId: string; prop: string } | undefined {
	if (!locals || typeof value !== 'object' || value === null) return undefined;
	return ((locals as Record<symbol, unknown>)[OWNERS] as Owners | undefined)?.get(value);
}
