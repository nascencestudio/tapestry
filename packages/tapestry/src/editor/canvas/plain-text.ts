/**
 * Inline editing of plain `text` props on the canvas (rich text has its own
 * editor, inline.ts). Components don't need to do anything: when a component is
 * selected, each of its `text` props is matched to the element showing it, and
 * that element becomes editable (`contenteditable="plaintext-only"`).
 *
 * Matching, inside the selected component (not inside nested components):
 * - an element marked `data-tapestry-text-prop="<prop>"` (optional, for
 *   components whose markup doesn't show the value as-is), else
 * - the one element without child elements whose text equals the value.
 * No match, or more than one, leaves that prop to the settings panel.
 *
 * Typing commits like the settings field (one undo step per burst) without
 * re-rendering the canvas; Enter and Escape finish. See ADR 0024.
 */
import { effect } from '@preact/signals';
import { NODE_ATTR } from '../../runtime/canvas-mode.js';
import type { ComponentManifest, TapestryNode, TextProp } from '../../types.js';
import { LIMITS } from '../../validate.js';
import type { EditorStore } from '../store.js';
import { findNode, updateProps } from '../tree.js';

/** Set on an element while it edits a plain text prop; the value is the prop name. */
export const PLAIN_ATTR = 'data-tapestry-plain';
/** Optional marker components can put on the element that shows a text prop. */
export const EXPLICIT_ATTR = 'data-tapestry-text-prop';

/** The text props of a node and the element showing each (only unambiguous matches). */
export function findPlainTargets(
	marker: Element,
	node: TapestryNode,
	manifest: ComponentManifest,
): Array<{ prop: string; def: TextProp; element: HTMLElement }> {
	const defs = Object.entries(manifest[node.type]?.props ?? {}).filter(
		(entry): entry is [string, TextProp] => entry[1].type === 'text',
	);
	if (defs.length === 0) return [];
	// Elements that belong to this component, not to a component nested inside it, and not to an
	// island (its framework owns that markup and would undo or fight the edits).
	const own = Array.from(marker.querySelectorAll<HTMLElement>('*')).filter(
		(el) => el.closest(`[${NODE_ATTR}]`) === marker && !el.closest('[data-tapestry-text], astro-island'),
	);
	const found: Array<{ prop: string; def: TextProp; element: HTMLElement }> = [];
	const used = new Set<HTMLElement>();
	for (const [prop, def] of defs) {
		const explicit = own.filter((el) => el.getAttribute(EXPLICIT_ATTR) === prop);
		let match: HTMLElement | undefined;
		if (explicit.length === 1) match = explicit[0];
		else if (explicit.length === 0) {
			const value = node.props[prop];
			if (typeof value !== 'string' || !value.trim()) continue;
			const candidates = own.filter((el) => el.children.length === 0 && (el.textContent ?? '').trim() === value.trim());
			if (candidates.length === 1) match = candidates[0];
		}
		// Two props showing the same element (equal values): ambiguous, leave both to the panel.
		if (!match) continue;
		if (used.has(match)) {
			const other = found.findIndex((f) => f.element === match);
			if (other !== -1) found.splice(other, 1);
			continue;
		}
		used.add(match);
		found.push({ prop, def, element: match });
	}
	return found;
}

/** A value as it can be stored in a single-line text prop. */
export function cleanPlainText(text: string, maxLength: number): string {
	return text.replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

interface Options {
	store: EditorStore;
	announce: (message: string) => void;
	/** Called after each committed edit (e.g. to redraw the overlay). */
	onInput: () => void;
	/** Called when editing a text ends (focus leaves it), so the canvas can re-render. */
	onDone: () => void;
	/** The canvas page's document (inside the iframe), when loaded. */
	getDocument: () => Document | null;
}

export function createPlainTextEditor({ store, announce, onInput, onDone, getDocument }: Options) {
	let cleanups: Array<() => void> = [];
	let committing = false;
	let activeNode: string | null = null;

	function deactivate() {
		for (const cleanup of cleanups) cleanup();
		cleanups = [];
		activeNode = null;
	}

	/** Make the selected component's text props editable in place (call again after re-renders). */
	function activate(root: ParentNode, nodeId: string | null) {
		deactivate();
		if (!nodeId) return;
		const node = findNode(store.doc.peek(), nodeId)?.node;
		const marker = root.querySelector(`[${NODE_ATTR}="${CSS.escape(nodeId)}"]`);
		if (!node || !marker) return;
		activeNode = nodeId;
		for (const { prop, def, element } of findPlainTargets(marker, node, store.manifest)) {
			const max = def.maxLength ?? LIMITS.textMaxLength;
			element.setAttribute('contenteditable', 'plaintext-only');
			element.setAttribute(PLAIN_ATTR, prop);
			element.setAttribute('role', 'textbox');
			element.setAttribute('aria-label', `${def.label} (edit on the page)`);
			element.spellcheck = true;

			const onInputEvent = () => {
				let value = cleanPlainText(element.textContent ?? '', max);
				if (value !== element.textContent) {
					// Newlines or too much text: show what's stored, caret at the end.
					element.textContent = value;
					const range = element.ownerDocument.createRange();
					range.selectNodeContents(element);
					range.collapse(false);
					const selection = element.ownerDocument.getSelection();
					selection?.removeAllRanges();
					selection?.addRange(range);
					value = element.textContent ?? '';
				}
				committing = true;
				try {
					store.commit(updateProps(store.doc.peek(), nodeId, { [prop]: value }), {
						coalesceKey: `${nodeId}.${prop}`,
					});
				} finally {
					committing = false;
				}
				onInput();
			};
			const onKey = (event: KeyboardEvent) => {
				if (event.key === 'Enter' || event.key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					element.blur();
					announce(`Finished editing ${def.label}.`);
				}
			};
			const onBlur = () => onDone();
			element.addEventListener('input', onInputEvent);
			element.addEventListener('keydown', onKey);
			element.addEventListener('blur', onBlur);
			// Outside changes (undo, the settings field) show up here unless it's being typed in.
			const stopSync = effect(() => {
				const current = findNode(store.doc.value, nodeId)?.node.props[prop];
				if (
					typeof current === 'string' &&
					element.ownerDocument.activeElement !== element &&
					element.textContent !== current
				) {
					element.textContent = current;
				}
			});
			cleanups.push(() => {
				stopSync();
				element.removeEventListener('input', onInputEvent);
				element.removeEventListener('keydown', onKey);
				element.removeEventListener('blur', onBlur);
				for (const name of ['contenteditable', PLAIN_ATTR, 'role', 'aria-label', 'spellcheck']) {
					element.removeAttribute(name);
				}
			});
		}
	}

	/**
	 * Before the canvas replaces its markup: stop listening (so the swap doesn't count
	 * as finishing the edit) and remember the focused text and caret, for `resume()`.
	 */
	function suspend(): { prop: string; start: number; end: number } | null {
		const doc = cleanups.length ? getDocument() : null;
		const active = doc?.activeElement as HTMLElement | null | undefined;
		const prop = active?.getAttribute(PLAIN_ATTR);
		let saved: { prop: string; start: number; end: number } | null = null;
		if (active && prop) {
			const selection = doc?.getSelection();
			const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
			const offset = (node: Node, at: number) => {
				const before = doc?.createRange();
				if (!before) return 0;
				before.selectNodeContents(active);
				before.setEnd(node, at);
				return before.toString().length;
			};
			saved =
				range && active.contains(range.startContainer)
					? {
							prop,
							start: offset(range.startContainer, range.startOffset),
							end: offset(range.endContainer, range.endOffset),
						}
					: { prop, start: (active.textContent ?? '').length, end: (active.textContent ?? '').length };
		}
		const nodeId = activeNode;
		deactivate();
		activeNode = nodeId;
		return saved;
	}

	/** After `activate()` on the new markup: put focus and the caret back where they were. */
	function resume(saved: { prop: string; start: number; end: number } | null) {
		if (!saved) return;
		const doc = getDocument();
		const element = doc?.querySelector<HTMLElement>(`[${PLAIN_ATTR}="${CSS.escape(saved.prop)}"]`);
		if (!doc || !element) return;
		element.focus();
		const text = element.firstChild;
		const range = doc.createRange();
		if (text && text.nodeType === Node.TEXT_NODE) {
			const length = text.textContent?.length ?? 0;
			range.setStart(text, Math.min(saved.start, length));
			range.setEnd(text, Math.min(saved.end, length));
		} else {
			range.selectNodeContents(element);
			range.collapse(false);
		}
		const selection = doc.getSelection();
		selection?.removeAllRanges();
		selection?.addRange(range);
	}

	return {
		activate,
		deactivate,
		suspend,
		resume,
		/** True while a change is being committed from the canvas text itself. */
		isCommitting: () => committing,
		/** The node whose text is editable, if any. */
		activeNode: () => activeNode,
		/** The editable plain text element a target is in, if any. */
		targetOf: (target: Element | null) => target?.closest<HTMLElement>(`[${PLAIN_ATTR}]`) ?? null,
	};
}

export type PlainTextEditor = ReturnType<typeof createPlainTextEditor>;
