/**
 * Inline editing of rich text props directly on the canvas (ADR 0013).
 *
 * In canvas mode, `RichText.astro` wraps each rich text prop's output in
 * `<tapestry-canvas-text data-tapestry-text="nodeId" data-tapestry-prop="prop">`.
 * When a component with rich text is selected, that wrapper becomes a
 * ProseMirror editor right away (same schema, commands and toolbar as the
 * settings field); the toolbar sits under the selection chip. Edits are
 * committed to the store like any prop edit.
 *
 * ProseMirror is loaded on demand (richtext-loader.ts); this module stays in
 * the editor's main chunk and has no ProseMirror imports.
 */
import { effect, signal } from '@preact/signals';
import { TEXT_ATTR, TEXT_PROP_ATTR } from '../../runtime/canvas-mode.js';
import type { RichTextProp } from '../../types.js';
import type { RichTextSession } from '../richtext-editor.js';
import { preloadRichText, type RichTextModule } from '../richtext-loader.js';
import type { EditorStore } from '../store.js';
import { findNode, updateProps } from '../tree.js';

export const EDITING_ATTR = 'data-tapestry-editing';

/**
 * Rich text fields the canvas can currently edit in place (`nodeId.prop`).
 * The settings panel shows a pointer to the canvas instead of the field for these.
 */
export const canvasTextTargets = signal<ReadonlySet<string>>(new Set());
/** Marks the element holding the inline toolbar. */
export const INLINE_TOOLBAR_ATTR = 'data-tapestry-inline-toolbar';

export interface InlineEditing {
	nodeId: string;
	prop: string;
	label: string;
	session: RichTextSession;
	Toolbar: RichTextModule['RichTextToolbar'];
}

/** Where to put the caret when editing starts. */
export interface StartOptions {
	/** Viewport point (the canvas window's coordinates) to place the caret at. */
	point?: { x: number; y: number };
	/** A selection to restore (after a re-render). */
	selection?: { anchor: number; head: number };
	/** Focus the text (default true). False makes it editable without taking focus. */
	focus?: boolean;
}

/** What `suspend()` remembers, to resume editing on the re-rendered wrapper. */
export interface Suspended {
	nodeId: string;
	prop: string;
	selection: { anchor: number; head: number };
	focused: boolean;
}

interface Options {
	store: EditorStore;
	announce: (message: string) => void;
	/** Called when inline editing starts (with its state) or stops (null). */
	onChange: (editing: InlineEditing | null) => void;
	/** Called after every edit and toolbar change (e.g. to redraw the overlay). */
	onInput: () => void;
}

/** The text wrapper a target is in, if any. */
export function textWrapperOf(target: Element | null): HTMLElement | null {
	return (target?.closest(`[${TEXT_ATTR}]`) as HTMLElement | null) ?? null;
}

/** The rich text wrapper for a node and prop inside `root`. */
export function wrapperFor(root: ParentNode, nodeId: string, prop?: string): HTMLElement | null {
	const id = CSS.escape(nodeId);
	const selector = prop ? `[${TEXT_ATTR}="${id}"][${TEXT_PROP_ATTR}="${CSS.escape(prop)}"]` : `[${TEXT_ATTR}="${id}"]`;
	return root.querySelector<HTMLElement>(selector);
}

export function createInlineEditor({ store, announce, onChange, onInput }: Options) {
	let current: (InlineEditing & { wrapper: HTMLElement; stop: () => void }) | null = null;
	let starting = 0;
	let committing = false;

	function defFor(nodeId: string, prop: string): RichTextProp | null {
		const node = findNode(store.doc.peek(), nodeId)?.node;
		const def = node ? store.manifest[node.type]?.props?.[prop] : undefined;
		return def?.type === 'richtext' ? def : null;
	}

	async function start(wrapper: HTMLElement, options: StartOptions = {}) {
		const nodeId = wrapper.getAttribute(TEXT_ATTR) ?? '';
		const prop = wrapper.getAttribute(TEXT_PROP_ATTR) ?? '';
		if (current?.wrapper === wrapper) {
			if (options.point || options.focus) current.session.focusAt(options.point);
			return;
		}
		const def = defFor(nodeId, prop);
		if (!def) return;
		stop();
		const attempt = ++starting;
		const mod = await preloadRichText();
		// Another start/stop happened while loading, or the canvas re-rendered.
		if (attempt !== starting || !wrapper.isConnected) return;

		const node = findNode(store.doc.peek(), nodeId)?.node;
		if (!node) return;
		wrapper.setAttribute(EDITING_ATTR, '');
		const session = mod.createRichTextSession(
			{ mount: wrapper },
			{
				def,
				value: node.props[prop],
				attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': `${def.label} (edit on the page)` },
				onChange: (value) => {
					committing = true;
					try {
						store.commit(updateProps(store.doc.peek(), nodeId, { [prop]: value }), {
							coalesceKey: `${nodeId}.${prop}`,
						});
					} finally {
						committing = false;
					}
					onInput();
				},
				keys: {
					Escape: () => {
						stop();
						announce('Stopped editing text. Click the text to edit it again.');
						return true;
					},
				},
			},
		);

		const isCurrent = () => current?.session === session;
		// Outside changes (undo, the settings field) flow in; deleting or
		// deselecting the node ends inline editing.
		const stopSync = effect(() => {
			const found = findNode(store.doc.value, nodeId)?.node;
			if (!found) {
				queueMicrotask(() => isCurrent() && stop());
				return;
			}
			session.sync(found.props[prop]);
		});
		const stopSelection = effect(() => {
			if (store.selectedId.value !== nodeId) queueMicrotask(() => isCurrent() && stop());
		});
		const stopToolbarWatch = effect(() => {
			session.version.value;
			session.link.value;
			onInput();
		});

		current = {
			nodeId,
			prop,
			label: def.label,
			session,
			Toolbar: mod.RichTextToolbar,
			wrapper,
			stop: () => {
				stopSync();
				stopSelection();
				stopToolbarWatch();
				// ProseMirror empties its element when destroyed; keep a static copy of
				// the text in place until the canvas re-renders it.
				const snapshot = Array.from(wrapper.childNodes, (child) => child.cloneNode(true));
				session.destroy();
				wrapper.replaceChildren(...snapshot);
				for (const name of ['contenteditable', 'translate', 'role', 'aria-multiline', 'aria-label']) {
					wrapper.removeAttribute(name);
				}
				wrapper.classList.remove('ProseMirror', 'ProseMirror-focused');
				wrapper.removeAttribute(EDITING_ATTR);
			},
		};
		onChange(current);
		if (options.selection) session.restoreSelection(options.selection, options.focus !== false);
		else if (options.focus !== false) session.focusAt(options.point);
	}

	function stop() {
		starting++;
		if (!current) return;
		const ending = current;
		current = null;
		ending.stop();
		onChange(null);
	}

	/** Stop editing but remember where it was, so `resume()` can continue after a re-render. */
	function suspend(): Suspended | null {
		if (!current) return null;
		const { nodeId, prop, session, wrapper } = current;
		const saved: Suspended = {
			nodeId,
			prop,
			selection: session.selectionRange(),
			focused: wrapper.ownerDocument.hasFocus() && wrapper.contains(wrapper.ownerDocument.activeElement),
		};
		stop();
		return saved;
	}

	function resume(saved: Suspended | null, root: ParentNode) {
		if (!saved || store.selectedId.peek() !== saved.nodeId) return;
		const wrapper = wrapperFor(root, saved.nodeId, saved.prop);
		if (wrapper) void start(wrapper, { selection: saved.selection, focus: saved.focused });
	}

	return {
		start,
		stop,
		suspend,
		resume,
		/** True while a change is being committed from the inline editor itself. */
		isCommitting: () => committing,
		/** The wrapper being edited, if any. */
		active: () => current?.wrapper ?? null,
		/** The node being edited, if any. */
		activeNode: () => current?.nodeId ?? null,
	};
}

export type InlineEditor = ReturnType<typeof createInlineEditor>;
