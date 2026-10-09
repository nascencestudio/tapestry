/**
 * Drives the visual canvas: an iframe showing the real page (site layout, CSS
 * and components) in canvas mode. See docs/decisions/0010-visual-canvas.md.
 *
 * - Keeps the iframe in sync with the editor's document by POSTing it to the
 *   render endpoint and swapping the `[data-tapestry-root]` contents (no reload).
 * - Draws hover/selection outlines and a toolbar chip in an overlay layer.
 * - Maps clicks to node selection, blocks navigation inside the canvas.
 * - Handles native drag and drop inside the iframe (from the library, the layer
 *   tree, or the chip's drag handle) using `geometry.ts`.
 *
 * The iframe is same-origin (it's the site itself), so the editor can reach
 * into its document directly.
 */
import { effect } from '@preact/signals';
import { h, render } from 'preact';
import { NODE_ATTR, ROOT_ATTR, SLOT_ATTR, SLOT_OF_ATTR, TEXT_ATTR } from '../../runtime/canvas-mode.js';
import type { TapestryDocument, TapestryNode } from '../../types.js';
import { activeDrag, applyDrop, type DragData } from '../dnd.js';
import type { EditorStore } from '../store.js';
import { copySelection, handleStructureKey, pasteClipboard } from '../structure-keys.js';
import { duplicateNode, findNode, removeNode } from '../tree.js';
import { type Indicator, type Placement, type Rect, resolveCanvasDrop } from './geometry.js';

import {
	canvasTextTargets,
	createInlineEditor,
	EDITING_ATTR,
	INLINE_TOOLBAR_ATTR,
	textWrapperOf,
	wrapperFor,
} from './inline.js';
import { singleChangedNode, subtreeDocument } from './partial.js';
import { createPlainTextEditor, PLAIN_ATTR } from './plain-text.js';
import { pendingScripts, runScripts, scriptKeys } from './scripts.js';

export type CanvasState = 'loading' | 'ready' | 'unsupported' | 'error';

export interface CanvasControllerOptions {
	iframe: HTMLIFrameElement;
	store: EditorStore;
	renderUrl: string;
	announce: (message: string) => void;
	onStatus: (state: CanvasState, message?: string) => void;
	/** Keyboard shortcuts pressed while focus is inside the canvas. Return true if handled. */
	onKeyDown?: (event: KeyboardEvent) => boolean;
}

/**
 * The document as the render endpoint needs it: node labels (editor-only names,
 * never rendered) left out, so renaming a node doesn't re-render the page.
 * Only node-level `label` keys are removed; props named "label" stay.
 */
function renderJson(document: TapestryDocument): string {
	const strip = (nodes: TapestryNode[]): TapestryNode[] =>
		nodes.map(({ label: _label, children, ...rest }) => (children ? { ...rest, children: strip(children) } : rest));
	return JSON.stringify({ ...document, root: strip(document.root) });
}

/** Debounce for re-rendering after edits (ms). Typing produces many edits. */
export const RENDER_DEBOUNCE_MS = 120;

const OVERLAY_ID = 'tapestry-canvas-overlay';
const STYLE_ID = 'tapestry-canvas-style';

const CANVAS_CSS = `
#${OVERLAY_ID} { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
#${OVERLAY_ID} * { box-sizing: border-box; }
#${OVERLAY_ID} .tc-box { position: absolute; display: none; border-radius: 2px; }
#${OVERLAY_ID} .tc-hover { outline: 1px dashed #8b5cf6; outline-offset: -1px; }
#${OVERLAY_ID} .tc-selected { outline: 2px solid #6d4ed6; outline-offset: -1px; }
#${OVERLAY_ID} .tc-outline { outline: 2px dashed #6d4ed6; outline-offset: -2px; background: rgb(109 78 214 / 0.06); }
#${OVERLAY_ID} .tc-line { position: absolute; display: none; background: #6d4ed6; border-radius: 2px; box-shadow: 0 0 0 1px #fff; }
#${OVERLAY_ID} .tc-chip { position: absolute; display: none; align-items: stretch; pointer-events: auto;
	background: #6d4ed6; color: #fff; font: 600 12px/1 system-ui, sans-serif; border-radius: 4px; overflow: hidden;
	box-shadow: 0 1px 3px rgb(0 0 0 / 0.3); white-space: nowrap; }
/* \`all: unset\` also resets -webkit-user-drag, so the drag handle restores it below. */
#${OVERLAY_ID} .tc-chip > * { all: unset; display: inline-flex; align-items: center; padding: 5px 7px; color: #fff; cursor: pointer; }
#${OVERLAY_ID} .tc-chip > [draggable] { cursor: grab; gap: 6px; -webkit-user-drag: element; user-select: none; }
#${OVERLAY_ID} .tc-chip > button:hover, #${OVERLAY_ID} .tc-chip > button:focus-visible { background: rgb(255 255 255 / 0.2); }
#${OVERLAY_ID}.tc-dragging .tc-chip { pointer-events: none; opacity: 0.5; }
#${OVERLAY_ID} .tc-chip[data-locked] > button { display: none; }
#${OVERLAY_ID} .tc-chip[data-locked] > [data-tapestry-chip-handle] { cursor: default; }
[${NODE_ATTR}] > * { cursor: grab; }
[${NODE_ATTR}] > *:active { cursor: grabbing; }
[${TEXT_ATTR}] { cursor: text; }
[${NODE_ATTR}] > * [${TEXT_ATTR}], [${NODE_ATTR}] > * [${TEXT_ATTR}] * { cursor: text; }
[${PLAIN_ATTR}] { cursor: text; outline: 1px dashed rgb(139 92 246 / 0.55); outline-offset: 2px; }
[${PLAIN_ATTR}]:focus { outline: 2px solid #8b5cf6; }
[${EDITING_ATTR}] { display: block !important; outline: none !important; white-space: pre-wrap; word-wrap: break-word; }
[${EDITING_ATTR}] .tp-media-node { margin: 0.5em 0; }
[${EDITING_ATTR}] .tp-media-node img { display: block; max-width: 100%; height: auto; }
[${EDITING_ATTR}] .tp-media-node.ProseMirror-selectednode { outline: 2px solid #6d4ed6; outline-offset: 2px; }
[${EDITING_ATTR}] .tp-media-node__label { display: inline-block; padding: 0.5rem 0.75rem; border: 1px dashed currentColor;
	border-radius: 4px; font: 14px/1.3 system-ui, sans-serif; opacity: 0.8; }
#${OVERLAY_ID} .tc-format { position: absolute; display: none; pointer-events: auto; width: max-content; max-width: calc(100% - 8px);
	background: #fff; color: #1f1b2d; border: 1px solid #d6d0e8; border-radius: 6px; padding: 3px;
	box-shadow: 0 2px 8px rgb(0 0 0 / 0.18); font: 13px/1.2 system-ui, sans-serif; text-align: left; }
#${OVERLAY_ID} .tc-format .tp-richtext__toolbar { display: flex; flex-wrap: wrap; gap: 2px; }
#${OVERLAY_ID} .tc-format [hidden] { display: none !important; }
#${OVERLAY_ID} .tc-format button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center;
	justify-content: center; min-width: 28px; height: 26px; padding: 0 7px; border-radius: 4px; cursor: pointer;
	color: inherit; font: inherit; white-space: nowrap; }
#${OVERLAY_ID} .tc-format button:hover { background: #f0ecfa; }
#${OVERLAY_ID} .tc-format button:focus-visible { outline: 2px solid #6d4ed6; outline-offset: 1px; }
#${OVERLAY_ID} .tc-format button[aria-pressed="true"] { background: #6d4ed6; color: #fff; }
#${OVERLAY_ID} .tc-format .tp-richtext__button--bold { font-weight: 700; }
#${OVERLAY_ID} .tc-format .tp-richtext__button--italic { font-style: italic; }
#${OVERLAY_ID} .tc-format .tp-richtext__button--underline { text-decoration: underline; }
#${OVERLAY_ID} .tc-format .tp-richtext__button--strike { text-decoration: line-through; }
#${OVERLAY_ID} .tc-format .tp-richtext__link { display: flex; flex-wrap: wrap; align-items: center; gap: 4px;
	margin-top: 3px; padding: 4px 2px 2px; border-top: 1px solid #e6e1f2; }
#${OVERLAY_ID} .tc-format input { all: unset; box-sizing: border-box; flex: 1 1 12rem; min-width: 10rem; height: 26px;
	padding: 0 6px; border: 1px solid #c9c2de; border-radius: 4px; background: #fff; color: #1f1b2d; cursor: text; }
#${OVERLAY_ID} .tc-format input:focus { border-color: #6d4ed6; box-shadow: 0 0 0 1px #6d4ed6; }
#${OVERLAY_ID} .tc-format .tp-button { border: 1px solid #c9c2de; }
#${OVERLAY_ID} .tc-format .tp-icon { display: block; flex: none; width: 16px; height: 16px; }
#${OVERLAY_ID} .tc-format .tp-icon--chevron { width: 8px; height: 8px; opacity: 0.7; }
#${OVERLAY_ID} .tc-format .tp-glyph { display: inline-block; min-width: 16px; font-size: 14px; font-weight: 600; line-height: 1; text-align: center; }
#${OVERLAY_ID} .tc-format .tp-glyph--bold { font-weight: 800; }
#${OVERLAY_ID} .tc-format .tp-glyph--italic { font-family: Georgia, "Times New Roman", serif; font-style: italic; }
#${OVERLAY_ID} .tc-format .tp-glyph--underline { text-decoration: underline; }
#${OVERLAY_ID} .tc-format .tp-glyph--strike { text-decoration: line-through; }
#${OVERLAY_ID} .tc-format .tp-glyph--style { min-width: 20px; font-size: 12px; font-weight: 700; letter-spacing: -0.02em; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu-button { gap: 2px; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu-button[aria-expanded="true"] { background: #f0ecfa; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu-wrap { position: relative; display: inline-flex; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu { position: absolute; top: calc(100% + 4px); left: 0; display: flex;
	flex-direction: column; min-width: 11rem; padding: 4px; background: #fff; border: 1px solid #d6d0e8; border-radius: 6px;
	box-shadow: 0 4px 16px rgb(0 0 0 / 0.2); }
#${OVERLAY_ID} .tc-format .tp-richtext__menu--end { left: auto; right: 0; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu-item { justify-content: flex-start; gap: 10px; width: 100%; height: auto;
	padding: 6px 8px; }
#${OVERLAY_ID} .tc-format .tp-richtext__menu-item[aria-checked="true"] { color: #6d4ed6; font-weight: 600; }
#${OVERLAY_ID} .tc-format .tp-icon-default { display: inline-flex; opacity: 0.5; }
#${OVERLAY_ID} .tc-format .tp-field__error { flex-basis: 100%; margin: 0; color: #b42318; font-size: 12px; }
tapestry-canvas-empty { display: block; margin: 2rem; padding: 4rem 1rem; border: 2px dashed #8b5cf6; border-radius: 8px;
	text-align: center; font: 16px system-ui, sans-serif; color: #6d4ed6; }
tapestry-canvas-drop { display: flex; align-items: center; justify-content: center; min-height: 4.5rem; margin: 0.5rem 0;
	padding: 0.75rem; box-sizing: border-box; border: 2px dashed rgb(139 92 246 / 0.6); border-radius: 8px;
	background: rgb(139 92 246 / 0.06); font: 14px system-ui, sans-serif; color: #6d4ed6; text-align: center; }
astro-dev-toolbar { display: none !important; }
`;

function isTextEntry(target: EventTarget | null): boolean {
	const el = target as HTMLElement | null;
	return Boolean(el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)));
}

export function createCanvasController(options: CanvasControllerOptions) {
	const { iframe, store, renderUrl, announce, onStatus } = options;
	const manifest = store.manifest;

	let doc: Document | null = null;
	let win: Window | null = null;
	let root: Element | null = null;
	let overlay: HTMLElement | null = null;
	let hoverBox: HTMLElement;
	let selectBox: HTMLElement;
	let outlineBox: HTMLElement;
	let line: HTMLElement;
	let chip: HTMLElement;
	let chipHandle: HTMLElement;
	let chipLabel: HTMLElement;
	let formatBar: HTMLElement | null = null;

	let hoverId: string | null = null;
	let canvasDrag: DragData | null = null;
	/** Node chosen by the last mousedown, and the element made draggable for it. */
	let pressed: { id: string; el: HTMLElement; draggableAttr: string | null } | null = null;
	let selectedFromCanvas = false;
	let lastRendered = '';
	/** Scripts the canvas page has run (its own on load, plus ones from live renders). */
	let ranScripts = new Set<string>();
	/** The document the canvas currently shows (for partial re-renders); null when unknown. */
	let lastRenderedDoc: TapestryDocument | null = null;
	let renderTimer: ReturnType<typeof setTimeout> | undefined;
	let inflight: AbortController | null = null;
	let sequence = 0;
	let frame = 0;
	const cleanups: Array<() => void> = [];

	// Plain text props: editable in place on the selected component (plain-text.ts).
	const plain = createPlainTextEditor({
		store,
		announce,
		onInput: () => scheduleRedraw(),
		onDone: () => scheduleRender(),
		getDocument: () => doc,
	});
	const inline = createInlineEditor({
		store,
		announce,
		onInput: () => scheduleRedraw(),
		onChange: (editing) => {
			if (formatBar) {
				render(editing ? h(editing.Toolbar, { session: editing.session, label: editing.label }) : null, formatBar);
			}
			if (!editing) {
				// Replace the editor's DOM with a fresh render of the current document.
				lastRendered = '';
				lastRenderedDoc = null;
				scheduleRender();
			}
			scheduleRedraw();
		},
	});

	/** Make the selected node's rich text editable (without taking focus), if it has any. */
	function editSelectedText() {
		const id = store.selectedId.peek();
		if (!id || !root || inline.activeNode() === id || store.isLocked(id)) return;
		const wrapper = wrapperFor(root, id);
		if (wrapper) void inline.start(wrapper, { focus: false });
	}

	/** Which rich text fields the canvas can edit in place (`nodeId.prop`), for the settings panel. */
	function publishTextTargets() {
		const keys = new Set<string>();
		for (const el of root?.querySelectorAll('[data-tapestry-text]') ?? []) {
			const id = el.getAttribute('data-tapestry-text');
			if (store.isLocked(id)) continue; // locked components (ADR 0033) aren't edited on the canvas
			keys.add(`${id}.${el.getAttribute('data-tapestry-prop')}`);
		}
		canvasTextTargets.value = keys;
	}

	/** The selected node, unless it's locked for this user (then its text isn't editable here). */
	function editableSelection(): string | null {
		const id = store.selectedId.peek();
		return store.isLocked(id) ? null : id;
	}

	/** Start inline editing of the rich text wrapper at a target, selecting its node first. */
	function startInline(wrapper: HTMLElement, point?: { x: number; y: number }) {
		const id = wrapper.getAttribute(TEXT_ATTR);
		if (!id) return;
		if (store.selectedId.peek() !== id) {
			selectedFromCanvas = true;
			store.select(id);
		}
		if (store.isLocked(id)) return; // locked for this user (ADR 0033): selecting only
		void inline.start(wrapper, point ? { point } : {});
	}

	// ---------------------------------------------------------------- geometry

	function nodeElement(id: string): Element | null {
		return root?.querySelector(`[${NODE_ATTR}="${CSS.escape(id)}"]`) ?? null;
	}

	/** Bounding box of a node's rendered output (its wrapper is display: contents). */
	function rectOf(id: string): Rect | null {
		const el = nodeElement(id);
		if (!el || !doc) return null;
		const range = doc.createRange();
		range.selectNodeContents(el);
		const r = range.getBoundingClientRect();
		if (r.width === 0 && r.height === 0) return null;
		return { left: r.left, top: r.top, width: r.width, height: r.height };
	}

	/**
	 * The area each child area of a component with named slots occupies. Usually
	 * the element the component put the slot in (a column); when several slots
	 * share an element, just the slot's own content.
	 */
	function areasOf(id: string): Array<{ slot: string | undefined; rect: Rect }> {
		if (!root || !doc) return [];
		const owner = nodeElement(id);
		const wrappers = Array.from(root.querySelectorAll<HTMLElement>(`[${SLOT_OF_ATTR}="${CSS.escape(id)}"]`));
		return wrappers.flatMap((wrapper) => {
			const parent = wrapper.parentElement;
			const ownParent = parent && parent !== owner && !wrappers.some((w) => w !== wrapper && parent.contains(w));
			let r: DOMRect;
			if (ownParent) {
				r = parent.getBoundingClientRect();
			} else {
				const range = (doc as Document).createRange();
				range.selectNodeContents(wrapper);
				r = range.getBoundingClientRect();
			}
			if (r.width === 0 && r.height === 0) return [];
			const name = wrapper.getAttribute(SLOT_ATTR) || undefined;
			return [{ slot: name, rect: { left: r.left, top: r.top, width: r.width, height: r.height } }];
		});
	}

	/** Node ids under a point, innermost first. */
	function hitsAt(x: number, y: number): string[] {
		const ids: string[] = [];
		let el = doc?.elementFromPoint(x, y) ?? null;
		if (el && overlay?.contains(el)) return ids;
		while (el && el !== root) {
			const id = el.getAttribute(NODE_ATTR);
			if (id) ids.push(id);
			el = el.parentElement;
		}
		return ids;
	}

	// ----------------------------------------------------------------- overlay

	function place(el: HTMLElement, rect: Rect | null) {
		if (!rect) {
			el.style.display = 'none';
			return;
		}
		el.style.display = 'block';
		el.style.left = `${rect.left}px`;
		el.style.top = `${rect.top}px`;
		el.style.width = `${rect.width}px`;
		el.style.height = `${rect.height}px`;
	}

	function drawIndicator(indicator: Indicator | null) {
		if (!overlay) return;
		place(outlineBox, indicator?.outline ?? null);
		if (!indicator) {
			line.style.display = 'none';
			return;
		}
		const { x, y, length, orientation } = indicator.line;
		place(
			line,
			orientation === 'horizontal'
				? { left: x, top: y - 2, width: length, height: 4 }
				: { left: x - 2, top: y, width: 4, height: length },
		);
	}

	function redraw() {
		if (!overlay) return;
		const selected = store.selectedId.peek();
		const dragging = Boolean(canvasDrag || activeDrag.peek());
		place(hoverBox, !dragging && hoverId && hoverId !== selected ? rectOf(hoverId) : null);
		const rect = selected ? rectOf(selected) : null;
		place(selectBox, rect);
		// During a canvas drag the chip may be the drag source: keep it rendered,
		// because hiding the source element makes the browser cancel the drag.
		const editing = Boolean(rect && selected && inline.activeNode() === selected && !dragging);
		if (formatBar) formatBar.style.display = editing ? 'block' : 'none';
		if (rect && selected && (!dragging || canvasDrag)) {
			const node = findNode(store.doc.peek(), selected)?.node;
			const typeLabel = node ? (manifest[node.type]?.label ?? node.type) : '';
			chipLabel.textContent = node?.label ? `${typeLabel} – ${node.label}` : typeLabel;
			// Locked for this user (ADR 0033): no moving, duplicating or deleting from the chip.
			const locked = store.isLocked(selected);
			chip.toggleAttribute('data-locked', locked);
			if (!canvasDrag) chipHandle.draggable = !locked;
			chip.style.display = 'flex';
			const chipHeight = chip.offsetHeight || 22;
			const left = Math.max(0, rect.left);
			// Place the toolbar horizontally first: its height depends on how much it wraps.
			if (editing && formatBar) {
				// clientWidth excludes the scrollbar (innerWidth doesn't).
				const visible = doc?.documentElement.clientWidth ?? win?.innerWidth ?? 0;
				const maxLeft = Math.max(0, visible - formatBar.offsetWidth - 4);
				formatBar.style.left = `${Math.min(left, maxLeft)}px`;
			}
			const barHeight = editing && formatBar ? formatBar.offsetHeight + 2 : 0;
			const stack = chipHeight + barHeight;
			const viewport = win?.innerHeight ?? 0;
			// Chip, then the formatting toolbar under it, sit above the component so
			// they never cover its text. Without room above, they go below it; for a
			// component taller than the window, they stick to the top.
			let top: number;
			if (rect.top >= stack + 2) top = rect.top - stack - 2;
			else if (!editing) top = rect.top + 2;
			else if (rect.top >= 0 && rect.top + rect.height + 2 + stack <= viewport) top = rect.top + rect.height + 2;
			else top = 2;
			chip.style.left = `${left}px`;
			chip.style.top = `${top}px`;
			if (editing && formatBar) formatBar.style.top = `${top + chipHeight + 2}px`;
		} else {
			chip.style.display = 'none';
		}
	}

	function scheduleRedraw() {
		if (!win || frame) return;
		frame = win.requestAnimationFrame(() => {
			frame = 0;
			redraw();
		});
	}

	function scrollSelectedIntoView() {
		const id = store.selectedId.peek();
		const rect = id ? rectOf(id) : null;
		if (!rect || !win) return;
		if (rect.top < 0 || rect.top + Math.min(rect.height, 120) > win.innerHeight) {
			win.scrollTo({ top: win.scrollY + rect.top - 80, behavior: 'smooth' });
		}
	}

	function buildOverlay(d: Document) {
		d.getElementById(OVERLAY_ID)?.remove();
		if (!d.getElementById(STYLE_ID)) {
			const style = d.createElement('style');
			style.id = STYLE_ID;
			style.textContent = CANVAS_CSS;
			d.head.append(style);
		}
		overlay = d.createElement('div');
		overlay.id = OVERLAY_ID;
		const box = (cls: string) => {
			const el = d.createElement('div');
			el.className = `tc-box ${cls}`;
			overlay?.append(el);
			return el;
		};
		hoverBox = box('tc-hover');
		selectBox = box('tc-selected');
		outlineBox = box('tc-outline');
		line = d.createElement('div');
		line.className = 'tc-line';

		chip = d.createElement('div');
		chip.className = 'tc-chip';
		chip.setAttribute('data-tapestry-chip', '');
		const handle = d.createElement('span');
		chipHandle = handle;
		handle.draggable = true;
		handle.title = 'Drag to move';
		handle.setAttribute('data-tapestry-chip-handle', '');
		const grip = d.createElement('span');
		grip.textContent = '⋮⋮';
		chipLabel = d.createElement('span');
		handle.append(grip, chipLabel);
		const button = (text: string, label: string, onClick: () => void) => {
			const b = d.createElement('button');
			b.type = 'button';
			b.textContent = text;
			b.title = label;
			b.setAttribute('aria-label', label);
			b.addEventListener('click', (event) => {
				event.preventDefault();
				event.stopPropagation();
				onClick();
			});
			return b;
		};
		chip.append(
			handle,
			button('⧉', 'Duplicate', () => {
				const id = store.selectedId.peek();
				const result = id && duplicateNode(store.doc.peek(), manifest, id);
				if (result) store.commit(result.doc, { select: result.id });
			}),
			button('✕', 'Delete', () => {
				const id = store.selectedId.peek();
				if (id && store.commit(removeNode(store.doc.peek(), id), { select: null })) announce('Deleted.');
			}),
		);
		formatBar = d.createElement('div');
		formatBar.className = 'tc-format';
		formatBar.setAttribute(INLINE_TOOLBAR_ATTR, '');
		overlay.append(line, chip, formatBar);
		d.body.append(overlay);
	}

	function ensureEmptyPlaceholder() {
		if (!doc || !root) return;
		if (store.doc.peek().root.length === 0 && !root.querySelector('tapestry-canvas-empty')) {
			const empty = doc.createElement('tapestry-canvas-empty');
			empty.textContent = 'This page is empty. Drag components here.';
			root.append(empty);
		}
	}

	// --------------------------------------------------------------- rendering

	async function renderNow() {
		if (!doc || !root) return;
		const current = store.doc.peek();
		const json = renderJson(current);
		if (json === lastRendered) {
			setPending(false);
			return;
		}
		// One component's settings changed (the usual case while typing): render just its
		// subtree and swap it in, instead of the whole page (see partial.ts).
		const changedId = lastRenderedDoc ? singleChangedNode(lastRenderedDoc, current) : null;
		const oldMarkup = changedId ? root.querySelector(`[${NODE_ATTR}="${CSS.escape(changedId)}"]`) : null;
		const subtree = changedId && oldMarkup ? subtreeDocument(current, changedId) : null;
		const id = ++sequence;
		inflight?.abort();
		inflight = new AbortController();
		try {
			const response = await fetch(renderUrl, {
				method: 'POST',
				body: subtree ? renderJson(subtree) : json,
				credentials: 'same-origin',
				headers: { 'Content-Type': 'application/json' },
				signal: inflight.signal,
			});
			if (id !== sequence) return;
			if (!response.ok) {
				setPending(false);
				onStatus('error', `Preview failed (HTTP ${response.status}).`);
				return;
			}
			const html = await response.text();
			if (id !== sequence || !doc || !root) return;
			const rendered = new DOMParser().parseFromString(html, 'text/html');
			const fresh = rendered.querySelector(`[${ROOT_ATTR}]`);
			if (!fresh) {
				onStatus('error', 'Preview response had no Tapestry content.');
				return;
			}
			// The endpoint's output can carry Astro's page-level <style>/<link>/<script>
			// tags (e.g. inline dev styles, including StudioCMS dashboard CSS). The
			// canvas page already loaded the site's own CSS, so keep only the markup.
			// Scripts it needs that the canvas hasn't run yet (e.g. a newly added island) run after the swap.
			const scripts = pendingScripts(rendered, doc.baseURI, ranScripts);
			for (const el of fresh.querySelectorAll('style, link, script, meta, title, noscript')) el.remove();
			const target = doc;
			// Replacing the markup replaces text being edited: pause the edit and pick
			// it up again (same caret) on the fresh markup.
			const suspended = inline.suspend();
			const plainSaved = plain.suspend();
			const freshMarkup =
				subtree && changedId ? fresh.querySelector(`[${NODE_ATTR}="${CSS.escape(changedId)}"]`) : null;
			if (subtree && oldMarkup?.isConnected && freshMarkup) {
				oldMarkup.replaceWith(target.importNode(freshMarkup, true));
				iframe.dataset.tapestryRender = 'partial';
			} else if (subtree) {
				// The component didn't come back (or its old markup is gone): render the whole page.
				inline.resume(suspended, root);
				lastRendered = '';
				lastRenderedDoc = null;
				void renderNow();
				return;
			} else {
				root.replaceChildren(...Array.from(fresh.childNodes, (node) => target.importNode(node, true)));
				iframe.dataset.tapestryRender = 'full';
			}
			runScripts(target, scripts, ranScripts);
			lastRendered = json;
			lastRenderedDoc = current;
			publishTextTargets();
			inline.resume(suspended, root);
			plain.activate(root, editableSelection());
			plain.resume(plainSaved);
			ensureEmptyPlaceholder();
			onStatus('ready');
			redraw();
			setPending(false);
		} catch (error) {
			if ((error as Error).name !== 'AbortError') {
				setPending(false);
				onStatus('error', 'Preview request failed.');
			}
		}
	}

	/** `data-tapestry-pending` on the iframe while an update is queued or in flight (for styling and tests). */
	function setPending(pending: boolean) {
		iframe.toggleAttribute('data-tapestry-pending', pending);
	}

	function scheduleRender() {
		// Typing on the canvas already shows the change; re-rendering would only
		// interrupt it. Other changes (and the end of editing) render as usual.
		if (inline.isCommitting() || plain.isCommitting()) return;
		clearTimeout(renderTimer);
		if (renderJson(store.doc.peek()) === lastRendered) {
			// Nothing visible changed (e.g. a node's editor-only name, or an edit undone before it
			// rendered): drop any queued render and just refresh the chip.
			setPending(false);
			redraw();
			return;
		}
		setPending(true);
		renderTimer = setTimeout(renderNow, RENDER_DEBOUNCE_MS);
	}

	// ------------------------------------------------------------------ events

	function currentDrag(): DragData | null {
		return canvasDrag ?? activeDrag.peek();
	}

	function placementAt(x: number, y: number): Placement | null {
		const drag = currentDrag();
		if (!drag) return null;
		return resolveCanvasDrop({
			doc: store.doc.peek(),
			manifest,
			drag,
			pointer: { x, y },
			hits: hitsAt(x, y),
			rectOf,
			areasOf,
		});
	}

	function listen<K extends keyof DocumentEventMap>(
		target: Document,
		type: K,
		handler: (event: DocumentEventMap[K]) => void,
		capture = false,
	) {
		target.addEventListener(type, handler, { capture });
		cleanups.push(() => target.removeEventListener(type, handler, { capture }));
	}

	/**
	 * Which node a press on `target` should drag: the selected node if the press
	 * is inside it (so a selected container can be dragged from anywhere within
	 * it), otherwise the innermost node under the pointer.
	 */
	function dragNodeFor(target: Element): string | null {
		const selected = store.selectedId.peek();
		if (selected && nodeElement(selected)?.contains(target)) return selected;
		const wrapper = target.closest(`[${NODE_ATTR}]`);
		return wrapper && root?.contains(wrapper) ? wrapper.getAttribute(NODE_ATTR) : null;
	}

	/** The node's top-level rendered element that contains `target` (a direct child of its wrapper). */
	function topElementFor(id: string, target: Element): HTMLElement | null {
		const wrapper = nodeElement(id);
		let el: Element | null = target;
		while (el && el.parentElement !== wrapper) el = el.parentElement;
		return el instanceof (win as Window & typeof globalThis).HTMLElement ? el : null;
	}

	function releasePress() {
		if (!pressed) return;
		if (pressed.draggableAttr === null) pressed.el.removeAttribute('draggable');
		else pressed.el.setAttribute('draggable', pressed.draggableAttr);
		pressed = null;
	}

	function endCanvasDrag() {
		canvasDrag = null;
		releasePress();
		overlay?.classList.remove('tc-dragging');
		drawIndicator(null);
		scheduleRedraw();
	}

	function attachEvents(d: Document, w: Window) {
		// Make the pressed component draggable, so a click-and-drag on the page
		// moves it. Released on mouseup/dragend.
		listen(
			d,
			'mousedown',
			(event) => {
				releasePress();
				const target = event.target as Element | null;
				if (event.button !== 0 || !target || overlay?.contains(target)) return;
				// Pressing into text that's being edited, or the text of the selected
				// node (a click there starts editing), places the caret instead of dragging.
				const text = textWrapperOf(target);
				if (text && (text.hasAttribute(EDITING_ATTR) || text.getAttribute(TEXT_ATTR) === store.selectedId.peek())) {
					return;
				}
				if (plain.targetOf(target)) return; // editable plain text: place the caret
				const id = dragNodeFor(target);
				const el = id ? topElementFor(id, target) : null;
				if (!id || !el || store.isLocked(id)) return;
				pressed = { id, el, draggableAttr: el.getAttribute('draggable') };
				el.draggable = true;
			},
			true,
		);
		listen(d, 'mouseup', () => releasePress(), true);
		listen(
			d,
			'dragstart',
			(event) => {
				const target = event.target as Element | null;
				const fromChip = Boolean(target && overlay?.contains(target));
				const id = fromChip
					? target?.closest('[data-tapestry-chip-handle]') && store.selectedId.peek()
					: (pressed?.id ?? (target ? dragNodeFor(target) : null));
				// Nothing of ours to move (or a locked component): don't let page links/images be dragged out.
				if (!id || store.isLocked(id)) {
					event.preventDefault();
					return;
				}
				canvasDrag = { tapestry: 'node', id };
				event.dataTransfer?.setData('text/plain', id);
				if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
				// Changing the drag source's styles during dragstart makes Chrome abort
				// the drag, so visual changes wait until the drag is under way.
				setTimeout(() => {
					if (!canvasDrag) return;
					overlay?.classList.add('tc-dragging');
					scheduleRedraw();
				}, 0);
			},
			true,
		);
		listen(
			d,
			'dragend',
			() => {
				// A drag that started on editable plain text leaves it focused (Chrome refocuses the
				// source when the drag ends); leave it, or re-renders put the caret back and Ctrl+Z goes
				// to the browser instead of undoing the move.
				plain.targetOf(d.activeElement)?.blur();
				endCanvasDrag();
			},
			true,
		);
		listen(
			d,
			'click',
			(event) => {
				if (overlay?.contains(event.target as Node)) return;
				// The canvas is for editing: links and buttons on the page must not act.
				event.preventDefault();
				event.stopPropagation();
				const text = textWrapperOf(event.target as Element);
				if (text?.hasAttribute(EDITING_ATTR)) return; // a click inside the text being edited
				if (plain.targetOf(event.target as Element)) return; // a click into editable plain text
				const id = hitsAt(event.clientX, event.clientY)[0] ?? null;
				// A click on a component's text selects it and puts the caret there.
				if (text && id && text.getAttribute(TEXT_ATTR) === id) {
					startInline(text, { x: event.clientX, y: event.clientY });
					return;
				}
				selectedFromCanvas = true;
				store.select(id);
			},
			true,
		);
		listen(
			d,
			'dblclick',
			(event) => {
				const text = textWrapperOf(event.target as Element);
				if (!text || text.hasAttribute(EDITING_ATTR)) return;
				event.preventDefault();
				startInline(text, { x: event.clientX, y: event.clientY });
			},
			true,
		);
		listen(d, 'submit', (event) => event.preventDefault(), true);
		listen(d, 'mousemove', (event) => {
			const id = hitsAt(event.clientX, event.clientY)[0] ?? null;
			if (id !== hoverId) {
				hoverId = id;
				scheduleRedraw();
			}
		});
		listen(d, 'mouseleave', () => {
			hoverId = null;
			scheduleRedraw();
		});
		listen(d, 'dragover', (event) => {
			if (!currentDrag()) return;
			event.preventDefault();
			const placement = placementAt(event.clientX, event.clientY);
			if (event.dataTransfer) event.dataTransfer.dropEffect = placement ? 'move' : 'none';
			drawIndicator(placement?.indicator ?? null);
			place(hoverBox, null);
			// Drags from the dashboard: hide the chip so it doesn't cover drop targets.
			// Canvas drags: leave it alone, it may be the drag source.
			if (!canvasDrag) chip.style.display = 'none';
		});
		listen(d, 'dragleave', (event) => {
			if (!event.relatedTarget) drawIndicator(null);
		});
		listen(d, 'drop', (event) => {
			const drag = currentDrag();
			if (!drag) return;
			event.preventDefault();
			const placement = placementAt(event.clientX, event.clientY);
			drawIndicator(null);
			if (placement) {
				selectedFromCanvas = true;
				applyDrop(store, drag, placement.target, announce);
			}
			scheduleRedraw();
		});
		listen(d, 'keydown', (event) => {
			if (options.onKeyDown?.(event)) return;
			if (event.defaultPrevented) return; // handled by the inline text editor
			if (isTextEntry(event.target)) return;
			const id = store.selectedId.peek();
			// Arrows, Alt+arrows, Delete, Ctrl/⌘+D, Escape: the same commands as the layer tree.
			if (handleStructureKey(store, event, { announce, mode: 'canvas' })) return;
			if (event.key === 'Enter' && id) {
				// Enter on a selected component edits its (first) rich text on the page.
				const text = nodeElement(id)?.querySelector<HTMLElement>(`[${TEXT_ATTR}="${CSS.escape(id)}"]`);
				if (text) {
					event.preventDefault();
					startInline(text);
				}
			}
		});
		// Copy/cut/paste components on the canvas (text being edited keeps the browser's own behavior).
		const clipboardOptions = { announce, mode: 'canvas' as const };
		listen(d, 'copy', (event) => {
			if (!isTextEntry(event.target)) copySelection(store, event, clipboardOptions);
		});
		listen(d, 'cut', (event) => {
			if (!isTextEntry(event.target)) copySelection(store, event, { ...clipboardOptions, cut: true });
		});
		listen(d, 'paste', (event) => {
			if (!isTextEntry(event.target)) pasteClipboard(store, event, clipboardOptions);
		});
		const onScroll = () => scheduleRedraw();
		w.addEventListener('scroll', onScroll, { passive: true });
		w.addEventListener('resize', onScroll);
		cleanups.push(() => {
			w.removeEventListener('scroll', onScroll);
			w.removeEventListener('resize', onScroll);
		});
	}

	// ------------------------------------------------------------------- setup

	function setup() {
		for (const cleanup of cleanups.splice(0)) cleanup();
		doc = iframe.contentDocument;
		win = iframe.contentWindow;
		if (!doc || !win) {
			onStatus('error', 'The canvas could not be opened.');
			return;
		}
		inline.stop();
		ranScripts = scriptKeys(doc);
		root = doc.querySelector(`[${ROOT_ATTR}]`);
		if (!root) {
			overlay = null;
			onStatus(
				'unsupported',
				"This page's route doesn't support the canvas. Load pages with getPage() from @nascencestudio/tapestry/page (see docs/admin-bar.md).",
			);
			return;
		}
		buildOverlay(doc);
		attachEvents(doc, win);
		publishTextTargets();
		lastRendered = '';
		lastRenderedDoc = null;
		onStatus('ready');
		renderNow();
	}

	const stopRenderEffect = effect(() => {
		store.doc.value;
		scheduleRender();
	});
	const stopSelectionEffect = effect(() => {
		store.selectedId.value;
		editSelectedText();
		if (root) plain.activate(root, editableSelection());
		redraw();
		if (!selectedFromCanvas) scrollSelectedIntoView();
		selectedFromCanvas = false;
	});

	onStatus('loading');
	iframe.addEventListener('load', setup);
	if (iframe.contentDocument?.readyState === 'complete' && iframe.contentDocument.querySelector(`[${ROOT_ATTR}]`)) {
		setup();
	}

	return {
		/** Stop inline text editing, if active. */
		stopInlineEditing() {
			inline.stop();
		},
		/** Re-render now, bypassing the debounce (e.g. after a reload). */
		refresh() {
			lastRendered = '';
			lastRenderedDoc = null;
			renderNow();
		},
		dispose() {
			inline.stop();
			plain.deactivate();
			canvasTextTargets.value = new Set();
			clearTimeout(renderTimer);
			inflight?.abort();
			stopRenderEffect();
			stopSelectionEffect();
			iframe.removeEventListener('load', setup);
			for (const cleanup of cleanups.splice(0)) cleanup();
			overlay?.remove();
		},
	};
}

export type CanvasController = ReturnType<typeof createCanvasController>;
