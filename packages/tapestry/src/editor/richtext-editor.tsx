/**
 * The ProseMirror editing core shared by the settings-panel field
 * (RichTextField.tsx) and inline editing on the canvas (canvas/inline.ts):
 * a "session" (editor view + toolbar state) and the toolbar component.
 * See docs/decisions/0012-rich-text.md and 0013-inline-canvas-editing.md.
 */
import { type Signal, signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { baseKeymap, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { type MarkType, type NodeType, Node as PMNode, type Schema } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { type Command, EditorState, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import {
	ALIGN_BUTTON,
	DEFAULT_TOOLBAR,
	emptyRichText,
	type HeadingLevel,
	isAlignButton,
	isHeadingButton,
	isRichTextEmpty,
	RICH_TEXT_BUTTON_INFO,
	type RichTextButton,
	type RichTextDoc,
	stripDefaultAttrs,
	TEXT_ALIGNS,
	type TextAlign,
} from '../richtext.js';
import type { PropValue, RichTextProp } from '../types.js';
import { cleanRichTextProp, isSafeUrl } from '../validate.js';
import { GLYPHS, ICONS, StyleGlyph } from './icons.js';
import { chooseMedia, mediaAvailable, mediaItem } from './media.js';
import { schemaFor } from './richtext-schema.js';

export const BUTTONS = RICH_TEXT_BUTTON_INFO;

/** The stored value for a ProseMirror document (`undefined` when it has no text). */
export function toValue(doc: PMNode): RichTextDoc | undefined {
	const json = stripDefaultAttrs(doc.toJSON()) as RichTextDoc;
	return isRichTextEmpty(json) ? undefined : json;
}

export function toDoc(schema: Schema, def: RichTextProp, value: PropValue | undefined): PMNode {
	const cleaned = value === undefined ? emptyRichText() : (cleanRichTextProp(def, value).value ?? emptyRichText());
	try {
		return PMNode.fromJSON(schema, cleaned);
	} catch (error) {
		console.warn('[tapestry] rich text value does not fit the field; starting empty', error);
		return PMNode.fromJSON(schema, emptyRichText());
	}
}

function markActive(state: EditorState, type: MarkType): boolean {
	const { from, to, empty, $from } = state.selection;
	if (empty) return Boolean(type.isInSet(state.storedMarks ?? $from.marks()));
	return state.doc.rangeHasMark(from, to, type);
}

/** Depth of the nearest ancestor of the selection with one of `types`, or -1. */
function ancestorDepth(state: EditorState, types: (NodeType | undefined)[]): number {
	const { $from } = state.selection;
	for (let d = $from.depth; d > 0; d--) if (types.includes($from.node(d).type)) return d;
	return -1;
}

/** The link around the cursor or selection: its range and current href. */
function linkRange(state: EditorState): { from: number; to: number; href: string } {
	const link = state.schema.marks.link as MarkType;
	const { from, to, empty, $from } = state.selection;
	if (!empty) {
		let href = '';
		state.doc.nodesBetween(from, to, (node) => {
			href ||= link.isInSet(node.marks)?.attrs.href ?? '';
		});
		return { from, to, href };
	}
	const start = $from.start();
	let pos = 0;
	type Run = { from: number; to: number; href: string };
	let run: Run | null = null;
	let found: Run | null = null as Run | null;
	$from.parent.forEach((child) => {
		const mark = link.isInSet(child.marks);
		const end = pos + child.nodeSize;
		if (mark && run && run.href === mark.attrs.href && run.to === start + pos) run.to = start + end;
		else run = mark ? { from: start + pos, to: start + end, href: mark.attrs.href } : null;
		if (run && run.from <= from && from <= run.to && (run.from < from || from < run.to)) found = { ...run };
		pos = end;
	});
	return found ?? { from, to, href: '' };
}

/** Remove every mark (bold, italic, underline, strike, link) from the selection, or stop typing with them. */
export const clearFormatting: Command = (state, dispatch) => {
	const { from, to, empty } = state.selection;
	if (dispatch) {
		const tr = state.tr;
		if (empty) tr.setStoredMarks([]);
		else for (const mark of Object.values(state.schema.marks)) tr.removeMark(from, to, mark);
		dispatch(tr.scrollIntoView());
	}
	return true;
};

function buildCommands(schema: Schema) {
	const { nodes, marks } = schema;
	const listItem = nodes.listItem;
	const hardBreak = nodes.hardBreak as NodeType;
	const insertBreak: Command = (state, dispatch) => {
		dispatch?.(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView());
		return true;
	};
	const toggleList =
		(type: NodeType): Command =>
		(state, dispatch) => {
			const depth = ancestorDepth(state, [nodes.bulletList, nodes.orderedList]);
			if (depth > 0 && listItem) {
				const list = state.selection.$from.node(depth);
				if (list.type === type) return liftListItem(listItem)(state, dispatch);
				dispatch?.(state.tr.setNodeMarkup(state.selection.$from.before(depth), type));
				return true;
			}
			return wrapInList(type)(state, dispatch);
		};
	const aligned = 'textAlign' in (nodes.paragraph?.spec.attrs ?? {});
	/** Paragraph (level null) or heading, keeping the block's alignment. */
	const setBlock =
		(level: HeadingLevel | null): Command =>
		(state, dispatch) => {
			const textAlign = aligned ? (state.selection.$from.parent.attrs.textAlign ?? null) : undefined;
			const align = aligned ? { textAlign } : {};
			if (level === null) return setBlockType(nodes.paragraph as NodeType, align)(state, dispatch);
			if (!nodes.heading) return false;
			return setBlockType(nodes.heading, { level, ...align })(state, dispatch);
		};
	const toggleHeading =
		(level: HeadingLevel): Command =>
		(state, dispatch) =>
			state.selection.$from.parent.type === nodes.heading && state.selection.$from.parent.attrs.level === level
				? setBlock(null)(state, dispatch)
				: setBlock(level)(state, dispatch);
	/** Align every paragraph and heading in the selection (null = the site's default). */
	const setAlign =
		(textAlign: TextAlign | null): Command =>
		(state, dispatch) => {
			if (!aligned) return false;
			const { from, to } = state.selection;
			const tr = state.tr;
			state.doc.nodesBetween(from, to, (node, pos) => {
				if (node.isTextblock && 'textAlign' in node.attrs)
					tr.setNodeMarkup(pos, undefined, { ...node.attrs, textAlign });
			});
			if (!tr.docChanged) return false;
			dispatch?.(tr);
			return true;
		};
	const insertRule: Command = (state, dispatch) => {
		const rule = nodes.horizontalRule;
		if (!rule) return false;
		if (dispatch) {
			const tr = state.tr.replaceSelectionWith(rule.create());
			// A line at the very end gets a paragraph after it, so typing can continue.
			if (tr.doc.lastChild?.type === rule) {
				tr.insert(tr.doc.content.size, (nodes.paragraph as NodeType).create());
				tr.setSelection(TextSelection.atEnd(tr.doc));
			}
			dispatch(tr.scrollIntoView());
		}
		return true;
	};
	const toggleQuote: Command = (state, dispatch) =>
		ancestorDepth(state, [nodes.blockquote]) > 0
			? lift(state, dispatch)
			: wrapIn(nodes.blockquote as NodeType)(state, dispatch);

	const run: Partial<Record<RichTextButton, Command>> = { clearFormatting };
	for (const name of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript'] as const) {
		const mark = marks[name];
		if (mark) run[name] = toggleMark(mark);
	}
	if (nodes.bulletList) run.bulletList = toggleList(nodes.bulletList);
	if (nodes.orderedList) run.orderedList = toggleList(nodes.orderedList);
	if (nodes.blockquote) run.blockquote = toggleQuote;
	if (nodes.horizontalRule) run.horizontalRule = insertRule;
	for (const level of [1, 2, 3, 4, 5, 6] as const) {
		if (nodes.heading?.spec.parseDOM?.some((rule) => rule.tag === `h${level}`)) {
			run[`heading${level}`] = toggleHeading(level);
		}
	}
	for (const align of TEXT_ALIGNS) {
		run[ALIGN_BUTTON[align]] = setAlign(align);
	}

	const keys: Record<string, Command> = {
		'Mod-z': undo,
		'Shift-Mod-z': redo,
		'Mod-y': redo,
		'Shift-Enter': insertBreak,
		'Mod-\\': clearFormatting,
	};
	if (run.bold) keys['Mod-b'] = run.bold;
	if (run.italic) keys['Mod-i'] = run.italic;
	if (run.underline) keys['Mod-u'] = run.underline;
	if (run.strike) keys['Shift-Mod-x'] = run.strike;
	if (run.subscript) keys['Mod-,'] = run.subscript;
	if (run.superscript) keys['Mod-.'] = run.superscript;
	if (nodes.heading) {
		keys['Mod-Alt-0'] = setBlock(null);
		for (const level of [1, 2, 3, 4, 5, 6] as const) {
			const command = run[`heading${level}`];
			if (command) keys[`Mod-Alt-${level}`] = command;
		}
	}
	if (listItem) {
		keys.Enter = splitListItem(listItem);
		keys['Mod-['] = liftListItem(listItem);
		keys['Mod-]'] = sinkListItem(listItem);
	}
	return { run, keys, setBlock, setAlign };
}

function isActive(state: EditorState, button: RichTextButton): boolean {
	const { nodes, marks } = state.schema;
	switch (button) {
		case 'bold':
		case 'italic':
		case 'underline':
		case 'strike':
		case 'subscript':
		case 'superscript':
		case 'link': {
			const mark = marks[button];
			return mark ? markActive(state, mark) : false;
		}
		case 'bulletList':
		case 'orderedList': {
			const depth = ancestorDepth(state, [nodes.bulletList, nodes.orderedList]);
			return depth > 0 && state.selection.$from.node(depth).type === nodes[button];
		}
		case 'blockquote':
			return ancestorDepth(state, [nodes.blockquote]) > 0;
		default:
			return false; // actions and menus (media, horizontal line, remove formatting, …)
	}
}

/** The block type at the cursor, for the "Paragraph / Heading" dropdown: 0 = paragraph, 1–6 = heading level. */
function currentLevel(state: EditorState): number {
	const parent = state.selection.$from.parent;
	return parent.type === state.schema.nodes.heading ? Number(parent.attrs.level) : 0;
}

/** The alignment at the cursor ('' = the site's default). */
function currentAlign(state: EditorState): string {
	return (state.selection.$from.parent.attrs.textAlign as string | null) ?? '';
}

/**
 * Preview of a media library item inside the editor (panel field or canvas):
 * images show as the image, other kinds as their name. Built in the editor
 * view's own document (the canvas iframe for inline editing).
 */
function mediaNodeView(node: PMNode, view: EditorView) {
	const doc = view.dom.ownerDocument;
	const dom = doc.createElement('figure');
	dom.className = 'tp-media-node';
	dom.setAttribute('data-media-id', node.attrs.id);
	dom.contentEditable = 'false';
	const label = doc.createElement('span');
	label.className = 'tp-media-node__label';
	label.textContent = 'Loading media…';
	dom.append(label);
	void mediaItem(node.attrs.id).then((item) => {
		if (!item) {
			label.textContent = 'Missing media item';
			dom.classList.add('tp-media-node--missing');
			return;
		}
		if (item.kind === 'image') {
			const img = doc.createElement('img');
			img.src = item.url;
			img.alt = item.alt;
			dom.replaceChildren(img);
			return;
		}
		const kinds = { video: 'Video', audio: 'Audio', document: 'Document', remoteVideo: 'Video' } as const;
		label.textContent = `${kinds[item.kind as keyof typeof kinds] ?? 'Media'}: ${item.name}`;
		if (item.thumbnailUrl) {
			const img = doc.createElement('img');
			img.src = item.thumbnailUrl;
			img.alt = '';
			img.referrerPolicy = 'no-referrer';
			dom.prepend(img);
		}
	});
	return { dom, ignoreMutation: () => true, stopEvent: () => false };
}

export interface LinkEdit {
	from: number;
	to: number;
	href: string;
	existing: boolean;
	error?: string | undefined;
}

/** One live rich text editor: the view plus the state its toolbar renders from. */
export interface RichTextSession {
	view: EditorView;
	def: RichTextProp;
	toolbar: readonly RichTextButton[];
	/** Bumped on every transaction, so toolbars re-render (pressed states). */
	version: Signal<number>;
	/** The open link form, if any. */
	link: Signal<LinkEdit | null>;
	run: (button: RichTextButton) => void;
	/** Make the selected blocks paragraphs (null) or headings of a level. */
	setBlock: (level: HeadingLevel | null) => void;
	/** Align the selected blocks (null = the site's default). */
	setAlign: (align: TextAlign | null) => void;
	/** Focus, with the caret at a point (viewport coordinates of the editor's window) or at the end. */
	focusAt: (point?: { x: number; y: number }) => void;
	/** The current selection as document positions. */
	selectionRange: () => { anchor: number; head: number };
	/** Restore a selection (clamped to the document), optionally focusing. */
	restoreSelection: (range: { anchor: number; head: number }, focus: boolean) => void;
	/** Replace the content if `value` differs from what's in the editor (outside changes). */
	sync: (value: PropValue | undefined) => boolean;
	destroy: () => void;
}

export interface SessionOptions {
	def: RichTextProp;
	value: PropValue | undefined;
	/** Attributes for the editable element (id, aria-*, class). */
	attributes: Record<string, string>;
	onChange: (value: PropValue | undefined) => void;
	/** Extra key bindings, checked first (e.g. Escape to stop inline editing). */
	keys?: Record<string, Command>;
}

/**
 * Create an editor in `place`: an element to append to, or `{ mount }` to make
 * an existing element the editable one (inline canvas editing).
 */
export function createRichTextSession(
	place: HTMLElement | { mount: HTMLElement },
	options: SessionOptions,
): RichTextSession {
	const { def } = options;
	const toolbar = def.toolbar ?? DEFAULT_TOOLBAR;
	const schema = schemaFor(toolbar);
	const built = buildCommands(schema);
	const version = signal(0);
	const link = signal<LinkEdit | null>(null);
	const openLink = (state: EditorState) => {
		const range = linkRange(state);
		link.value = { ...range, existing: range.href !== '' };
	};
	const keys: Record<string, Command> = { ...built.keys };
	if (schema.marks.link) {
		keys['Mod-k'] = (state) => {
			openLink(state);
			return true;
		};
	}

	const view: EditorView = new EditorView(place, {
		...(schema.nodes.media ? { nodeViews: { media: (node, editorView) => mediaNodeView(node, editorView) } } : {}),
		state: EditorState.create({
			doc: toDoc(schema, def, options.value),
			plugins: [history(), keymap({ ...(options.keys ?? {}) }), keymap(keys), keymap(baseKeymap)],
		}),
		attributes: options.attributes,
		dispatchTransaction(tr: Transaction) {
			const next = view.state.apply(tr);
			view.updateState(next);
			version.value++;
			if (tr.docChanged) options.onChange(toValue(next.doc));
		},
	});

	/** Choose an item in the media library and insert it as a block. */
	async function insertMedia() {
		const media = schema.nodes.media;
		if (!media) return;
		const item = await chooseMedia(def.mediaAccept, `Insert media into ${def.label}`);
		if (item && !view.isDestroyed) {
			const tr = view.state.tr.replaceSelectionWith(media.create({ id: item.id }));
			if (tr.doc.lastChild?.type === media) {
				tr.insert(tr.doc.content.size, (schema.nodes.paragraph as NodeType).create());
				tr.setSelection(TextSelection.atEnd(tr.doc));
			}
			view.dispatch(tr.scrollIntoView());
		}
		view.focus();
	}

	return {
		view,
		def,
		toolbar,
		version,
		link,
		run(button) {
			if (button === 'media') {
				void insertMedia();
				return;
			}
			if (button === 'link') {
				if (link.peek()) link.value = null;
				else openLink(view.state);
				return;
			}
			built.run[button]?.(view.state, view.dispatch, view);
			view.focus();
		},
		setBlock(level) {
			built.setBlock(level)(view.state, view.dispatch, view);
			view.focus();
		},
		setAlign(align) {
			built.setAlign(align)(view.state, view.dispatch, view);
			view.focus();
		},
		focusAt(point) {
			const hit = point ? view.posAtCoords({ left: point.x, top: point.y }) : null;
			const selection = hit ? TextSelection.near(view.state.doc.resolve(hit.pos)) : Selection.atEnd(view.state.doc);
			view.dispatch(view.state.tr.setSelection(selection));
			view.focus();
		},
		selectionRange() {
			const { anchor, head } = view.state.selection;
			return { anchor, head };
		},
		restoreSelection(range, focus) {
			const max = view.state.doc.content.size;
			const clamp = (n: number) => Math.max(0, Math.min(n, max));
			try {
				const selection = TextSelection.between(
					view.state.doc.resolve(clamp(range.anchor)),
					view.state.doc.resolve(clamp(range.head)),
				);
				view.dispatch(view.state.tr.setSelection(selection));
			} catch {
				// Positions no longer valid: keep the default selection.
			}
			if (focus) view.focus();
		},
		sync(value) {
			const incoming = toDoc(schema, def, value);
			const current = toValue(view.state.doc);
			const wanted = value === undefined ? undefined : toValue(incoming);
			if (JSON.stringify(current ?? null) === JSON.stringify(wanted ?? null)) return false;
			view.updateState(EditorState.create({ doc: incoming, plugins: view.state.plugins }));
			version.value++;
			return true;
		},
		destroy() {
			view.destroy();
		},
	};
}

function applyLink(session: RichTextSession, remove = false) {
	const { view, link } = session;
	const edit = link.peek();
	if (!edit) return;
	const mark = view.state.schema.marks.link as MarkType;
	const href = edit.href.trim();
	const { from, to } = edit;
	if (remove) {
		view.dispatch(view.state.tr.removeMark(from, to, mark));
	} else {
		if (!href || !isSafeUrl(href)) {
			link.value = { ...edit, error: 'Use a relative link (/page) or http, https, mailto or tel.' };
			return;
		}
		const tr = view.state.tr;
		if (from === to) {
			// Inserted link text keeps the formatting active at the cursor (e.g. bold).
			const active = view.state.storedMarks ?? view.state.doc.resolve(from).marks();
			tr.insert(from, view.state.schema.text(href, mark.create({ href }).addToSet(active)));
		} else tr.removeMark(from, to, mark).addMark(from, to, mark.create({ href }));
		view.dispatch(tr);
	}
	link.value = null;
	view.focus();
}

interface MenuItem {
	value: string;
	label: string;
	icon: JSX.Element;
}

/**
 * A toolbar menu button (WAI-ARIA menu button pattern) whose icon shows the
 * current value, e.g. "H2" or the current alignment. Mouse use keeps the
 * editor's focus and selection; keyboard use moves focus into the menu
 * (arrows, Home/End, Escape, Tab) and back to the text after a choice.
 */
function MenuButton({
	format,
	label,
	shortcut,
	items,
	current,
	onPick,
	view,
}: {
	format: string;
	label: string;
	shortcut?: string;
	items: MenuItem[];
	current: string;
	onPick: (value: string) => void;
	view: EditorView;
}) {
	const [open, setOpen] = useState(false);
	const [flip, setFlip] = useState(false);
	const wrap = useRef<HTMLDivElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const button = useRef<HTMLButtonElement>(null);
	const focusItem = useRef<number | null>(null);
	const selected = items.find((item) => item.value === current) ?? items[0];
	const itemsEl = () => [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];

	// Close on a press anywhere else (in whichever document the toolbar lives in).
	useEffect(() => {
		if (!open) return;
		const doc = wrap.current?.ownerDocument;
		const onDown = (event: Event) => {
			if (!wrap.current?.contains(event.target as Node)) setOpen(false);
		};
		doc?.addEventListener('mousedown', onDown, true);
		return () => doc?.removeEventListener('mousedown', onDown, true);
	}, [open]);

	// Open towards the left when the menu would run past the right edge of the window.
	useLayoutEffect(() => {
		if (!open) {
			setFlip(false);
			return;
		}
		const el = menu.current;
		const doc = el?.ownerDocument;
		if (el && doc && el.getBoundingClientRect().right > doc.documentElement.clientWidth - 4) setFlip(true);
	}, [open]);

	useEffect(() => {
		if (open && focusItem.current !== null) {
			itemsEl()[focusItem.current]?.focus();
			focusItem.current = null;
		}
	}, [open]);

	const pick = (value: string) => {
		setOpen(false);
		onPick(value);
		view.focus();
	};
	const openWithKeyboard = (index: number) => {
		focusItem.current = index;
		setOpen(true);
	};

	return (
		<div class="tp-richtext__menu-wrap" ref={wrap}>
			<button
				ref={button}
				type="button"
				class={`tp-richtext__button tp-richtext__menu-button tp-richtext__button--${format}`}
				data-tapestry-format={format}
				data-value={current}
				aria-haspopup="menu"
				aria-expanded={open}
				aria-label={`${label}: ${selected?.label ?? ''}`}
				title={shortcut ? `${label} (${shortcut})` : label}
				onMouseDown={(e) => e.preventDefault()}
				onClick={(e) => {
					// detail 0: activated with the keyboard (Enter/Space), so move focus into the menu.
					if (open) setOpen(false);
					else if (e.detail === 0)
						openWithKeyboard(
							Math.max(
								0,
								items.findIndex((i) => i.value === current),
							),
						);
					else setOpen(true);
				}}
				onKeyDown={(e) => {
					if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
						e.preventDefault();
						openWithKeyboard(e.key === 'ArrowDown' ? 0 : items.length - 1);
					} else if (e.key === 'Escape' && open) {
						e.preventDefault();
						e.stopPropagation();
						setOpen(false);
					}
				}}
			>
				{selected?.icon}
				{ICONS.chevron}
			</button>
			{open && (
				<div
					ref={menu}
					class={`tp-richtext__menu${flip ? ' tp-richtext__menu--end' : ''}`}
					role="menu"
					aria-label={label}
					data-tapestry-menu={format}
				>
					{items.map((item, index) => (
						<button
							key={item.value}
							type="button"
							role="menuitemradio"
							aria-checked={item.value === current}
							class="tp-richtext__menu-item"
							data-tapestry-menu-item={item.value}
							tabIndex={-1}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => pick(item.value)}
							onKeyDown={(e) => {
								const all = itemsEl();
								const move = (to: number) => {
									e.preventDefault();
									all[(to + all.length) % all.length]?.focus();
								};
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									pick(item.value);
								} else if (e.key === 'ArrowDown') move(index + 1);
								else if (e.key === 'ArrowUp') move(index - 1);
								else if (e.key === 'Home') move(0);
								else if (e.key === 'End') move(all.length - 1);
								else if (e.key === 'Escape') {
									e.preventDefault();
									e.stopPropagation(); // don't also stop inline editing
									setOpen(false);
									button.current?.focus();
								} else if (e.key === 'Tab') setOpen(false);
							}}
						>
							{item.icon}
							<span>{item.label}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}

/** "P / H1–H6" menu: its icon shows the current block's style; levels limited to the toolbar. */
function HeadingMenu({ session }: { session: RichTextSession }) {
	const levels = session.toolbar.filter(isHeadingButton).map((b) => Number(b.slice(-1)) as HeadingLevel);
	const items: MenuItem[] = [
		{ value: '0', label: 'Paragraph', icon: <StyleGlyph level={0} /> },
		...levels.map((level) => ({ value: String(level), label: `Heading ${level}`, icon: <StyleGlyph level={level} /> })),
	];
	return (
		<MenuButton
			format="heading"
			label="Text style"
			shortcut="Ctrl/⌘+Alt+0–6"
			items={items}
			current={String(currentLevel(session.view.state))}
			view={session.view}
			onPick={(value) => {
				const level = Number(value);
				session.setBlock(level === 0 ? null : (level as HeadingLevel));
			}}
		/>
	);
}

/** Alignment menu: its icon shows the current block's alignment; options limited to the toolbar. */
function AlignMenu({ session }: { session: RichTextSession }) {
	const aligns = TEXT_ALIGNS.filter((a) => session.toolbar.includes(ALIGN_BUTTON[a]));
	const labels: Record<TextAlign, string> = {
		left: 'Align left',
		center: 'Align center',
		right: 'Align right',
		justify: 'Justify',
	};
	const items: MenuItem[] = [
		{ value: '', label: 'Default alignment', icon: <span class="tp-icon-default">{ICONS.alignLeft}</span> },
		...aligns.map((align) => ({
			value: align,
			label: labels[align],
			icon: ICONS[ALIGN_BUTTON[align] as keyof typeof ICONS],
		})),
	];
	return (
		<MenuButton
			format="align"
			label="Alignment"
			items={items}
			current={currentAlign(session.view.state)}
			view={session.view}
			onPick={(value) => session.setAlign((value || null) as TextAlign | null)}
		/>
	);
}

/** The icon for a plain toolbar button: a line icon or a letter. */
function ButtonIcon({ button }: { button: RichTextButton }) {
	if (button in ICONS) return ICONS[button as keyof typeof ICONS];
	const glyph = GLYPHS[button as keyof typeof GLYPHS];
	if (glyph) {
		return (
			<span class={`tp-glyph ${glyph.className}`} aria-hidden="true">
				{glyph.text}
			</span>
		);
	}
	return <span aria-hidden="true">{BUTTONS[button].label}</span>;
}

/** Formatting buttons and the link form for a session. */
export function RichTextToolbar({ session, label }: { session: RichTextSession; label: string }) {
	session.version.value; // re-render on every transaction
	const { view, toolbar } = session;
	const link = session.link.value;
	const linkInput = useRef<HTMLInputElement>(null);
	const linkOpen = link !== null;
	useEffect(() => {
		if (linkOpen) linkInput.current?.focus();
	}, [linkOpen]);

	return (
		<>
			<div
				class="tp-richtext__toolbar"
				role="toolbar"
				aria-label={`${label} formatting`}
				hidden={toolbar.length === 0}
				onKeyDown={(e) => {
					// Escape in the toolbar goes back to the text (it doesn't deselect the component).
					if (e.key === 'Escape' && !e.defaultPrevented) {
						e.preventDefault();
						e.stopPropagation();
						view.focus();
					}
				}}
			>
				{toolbar.map((button, index) => {
					// Headings and alignments render as one dropdown each, where the group first appears.
					if (isHeadingButton(button)) {
						return toolbar.findIndex(isHeadingButton) === index ? (
							<HeadingMenu key="heading" session={session} />
						) : null;
					}
					if (isAlignButton(button)) {
						return toolbar.findIndex(isAlignButton) === index ? <AlignMenu key="align" session={session} /> : null;
					}
					if (button === 'media' && !mediaAvailable()) return null; // the media library isn't installed
					const info = BUTTONS[button];
					return (
						<button
							key={button}
							type="button"
							class={`tp-richtext__button tp-richtext__button--${button}`}
							data-tapestry-format={button}
							aria-pressed={
								button === 'clearFormatting' || button === 'horizontalRule' || button === 'media'
									? undefined
									: isActive(view.state, button)
							}
							aria-label={info.title}
							title={info.shortcut ? `${info.title} (${info.shortcut})` : info.title}
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => session.run(button)}
						>
							<ButtonIcon button={button} />
						</button>
					);
				})}
			</div>
			{link && (
				<div class="tp-richtext__link" data-tapestry-link-form>
					<input
						class="tp-input"
						type="text"
						inputMode="url"
						spellcheck={false}
						aria-label="Link address"
						placeholder="/page, https://…, mailto:…"
						value={link.href}
						ref={linkInput}
						onInput={(e) => {
							session.link.value = { ...link, href: e.currentTarget.value, error: undefined };
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault(); // would submit (save) the page
								applyLink(session);
							} else if (e.key === 'Escape') {
								e.preventDefault();
								session.link.value = null;
								view.focus();
							}
						}}
					/>
					<button type="button" class="tp-button" data-tapestry-link-apply onClick={() => applyLink(session)}>
						Apply
					</button>
					{link.existing && (
						<button type="button" class="tp-button" data-tapestry-link-remove onClick={() => applyLink(session, true)}>
							Remove
						</button>
					)}
					{link.error && (
						<p class="tp-field__error" role="alert">
							{link.error}
						</p>
					)}
				</div>
			)}
		</>
	);
}
