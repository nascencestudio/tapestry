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

/**
 * Query parameter: the page canvas shows this template (`tt_…`, or `none`) instead of the saved choice,
 * so an unsaved change shows at once (ADR 0041).
 */
export const TEMPLATE_PARAM = 'tapestry-template';

/** Query parameters: a page without a template shows this header/footer (part id, or empty: none). */
export const HEADER_PARAM = 'tapestry-header';
export const FOOTER_PARAM = 'tapestry-footer';

/** Query parameter: the part editor's canvas (this part is edited in place; the body is a placeholder). */
export const PART_PARAM = 'tapestry-part';

/** Query parameter: the template editor's canvas (this template's body is edited, between its header and footer). */
export const EDIT_TEMPLATE_PARAM = 'tapestry-edit-template';
/** Canvas only (ADR 0046): the display mode each content area shows, its tab (`main:teaser,side:card`). */
export const TABS_PARAM = 'tapestry-tabs';
/**
 * Wraps documents rendered inside a component (a list's items, ADR 0046) in the canvas: they belong to
 * other pages, so the canvas never selects, edits or drops into anything inside.
 */
export const FOREIGN_ELEMENT = 'tapestry-foreign';

/** Attributes on `<tapestry-region>` (canvas mode): the region's name, its part, and the part being edited. */
export const REGION_ATTR = 'data-tapestry-region';
export const REGION_PART_ATTR = 'data-tapestry-part';
export const EDITING_PART_ATTR = 'data-tapestry-editing-part';

/** Attribute on a template's content area element (its key), from Area.astro (ADR 0041). */
export const AREA_ATTR = 'data-tapestry-area';

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

/** The editor's render requests (ADR 0046): the id of the page being edited, so lists can leave it out. */
export const PAGE_PARAM = 'tapestry-page';
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const CURRENT_PAGE = Symbol.for('tapestry.currentPage');

/** Record the page this request shows (getPage(); the render endpoint for the page being edited). */
export function setCurrentPage(locals: object, id: string | null | undefined): void {
	if (typeof id === 'string' && PAGE_ID.test(id)) (locals as Record<symbol, string>)[CURRENT_PAGE] = id;
}

/** The id of the page this request shows, or null. */
export function currentPage(locals: object): string | null {
	return (locals as Record<symbol, string | undefined>)[CURRENT_PAGE] ?? null;
}
