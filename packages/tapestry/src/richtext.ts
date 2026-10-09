/**
 * Rich text for `richtext` props: the stored format, cleaning against a
 * field's toolbar, plain-text conversion, and a render tree for RichText.astro.
 * See docs/decisions/0012-rich-text.md and docs/data-model.md#rich-text.
 *
 * The stored value is a small JSON tree, the same shape as ProseMirror's
 * `Node.toJSON()` for the schema built in editor/richtext-schema.ts. No HTML is
 * stored, and none is produced from strings: the render tree contains only
 * allowlisted tag names, and Astro escapes every text and attribute value.
 *
 * Pure functions only; shared by the validator, the renderer and the editor.
 */

/**
 * Toolbar entries a `richtext` prop can enable. Paragraphs and line breaks are
 * always allowed. `clearFormatting` is an action (removes marks), not something
 * content can contain. The `heading1`–`heading6` entries share one "Paragraph /
 * Heading" dropdown and the `align*` entries one alignment dropdown, shown where
 * the first entry of the group appears in the toolbar.
 */
export const RICH_TEXT_BUTTONS = [
	'bold',
	'italic',
	'underline',
	'strike',
	'subscript',
	'superscript',
	'link',
	'bulletList',
	'orderedList',
	'blockquote',
	'horizontalRule',
	'media',
	'heading1',
	'heading2',
	'heading3',
	'heading4',
	'heading5',
	'heading6',
	'alignLeft',
	'alignCenter',
	'alignRight',
	'alignJustify',
	'clearFormatting',
] as const;

export type RichTextButton = (typeof RICH_TEXT_BUTTONS)[number];

/** Media item ids from @nascencestudio/medialibrary: `m_` + 16 lowercase base-36 characters. */
export const MEDIA_ID = /^m_[a-z0-9]{16}$/;

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6];
export type TextAlign = 'left' | 'center' | 'right' | 'justify';
export const TEXT_ALIGNS: readonly TextAlign[] = ['left', 'center', 'right', 'justify'];
export const ALIGN_BUTTON: Record<TextAlign, RichTextButton> = {
	left: 'alignLeft',
	center: 'alignCenter',
	right: 'alignRight',
	justify: 'alignJustify',
};

export const isHeadingButton = (b: string): boolean => /^heading[1-6]$/.test(b);
export const isAlignButton = (b: string): boolean => /^align(Left|Center|Right|Justify)$/.test(b);

/** Display names for toolbar entries (editor and settings page). */
export const RICH_TEXT_BUTTON_INFO: Record<RichTextButton, { label: string; title: string; shortcut?: string }> = {
	bold: { label: 'B', title: 'Bold', shortcut: 'Ctrl/⌘+B' },
	italic: { label: 'I', title: 'Italic', shortcut: 'Ctrl/⌘+I' },
	underline: { label: 'U', title: 'Underline', shortcut: 'Ctrl/⌘+U' },
	strike: { label: 'S', title: 'Strikethrough', shortcut: 'Ctrl/⌘+Shift+X' },
	subscript: { label: 'X₂', title: 'Subscript', shortcut: 'Ctrl/⌘+,' },
	superscript: { label: 'X²', title: 'Superscript', shortcut: 'Ctrl/⌘+.' },
	link: { label: 'Link', title: 'Link', shortcut: 'Ctrl/⌘+K' },
	bulletList: { label: '• List', title: 'Bulleted list' },
	orderedList: { label: '1. List', title: 'Numbered list' },
	blockquote: { label: '❝ Quote', title: 'Quote' },
	horizontalRule: { label: '―', title: 'Horizontal line' },
	media: { label: 'Media', title: 'Insert media (image, video, audio or document)' },
	heading1: { label: 'H1', title: 'Heading 1', shortcut: 'Ctrl/⌘+Alt+1' },
	heading2: { label: 'H2', title: 'Heading 2', shortcut: 'Ctrl/⌘+Alt+2' },
	heading3: { label: 'H3', title: 'Heading 3', shortcut: 'Ctrl/⌘+Alt+3' },
	heading4: { label: 'H4', title: 'Heading 4', shortcut: 'Ctrl/⌘+Alt+4' },
	heading5: { label: 'H5', title: 'Heading 5', shortcut: 'Ctrl/⌘+Alt+5' },
	heading6: { label: 'H6', title: 'Heading 6', shortcut: 'Ctrl/⌘+Alt+6' },
	alignLeft: { label: 'Left', title: 'Align left' },
	alignCenter: { label: 'Center', title: 'Align center' },
	alignRight: { label: 'Right', title: 'Align right' },
	alignJustify: { label: 'Justify', title: 'Justify' },
	clearFormatting: { label: 'Tx', title: 'Remove formatting', shortcut: 'Ctrl/⌘+\\' },
};

/** Toolbar used when a prop doesn't list one. */
export const DEFAULT_TOOLBAR: readonly RichTextButton[] = [
	'bold',
	'italic',
	'link',
	'bulletList',
	'orderedList',
	'clearFormatting',
];

export const RICH_TEXT_LIMITS = {
	/** Default `maxLength`: characters of text (formatting not counted). */
	maxLength: 20_000,
	/** Nodes (blocks, text runs, line breaks) in one value. */
	maxNodes: 2_000,
	/** Block nesting (lists inside lists, quotes). */
	maxDepth: 8,
} as const;

export type MarkType = 'bold' | 'italic' | 'underline' | 'strike' | 'subscript' | 'superscript' | 'link';
export type RichTextMark = { type: Exclude<MarkType, 'link'> } | { type: 'link'; attrs: { href: string } };
export type RichTextInline = { type: 'text'; marks?: RichTextMark[]; text: string } | { type: 'hardBreak' };
export type RichTextBlock =
	| { type: 'paragraph'; attrs?: { textAlign: TextAlign }; content?: RichTextInline[] }
	| { type: 'heading'; attrs: { level: HeadingLevel; textAlign?: TextAlign }; content?: RichTextInline[] }
	| { type: 'blockquote'; content: RichTextBlock[] }
	| { type: 'bulletList' | 'orderedList'; content: RichTextListItem[] }
	| { type: 'listItem'; content: RichTextBlock[] }
	| { type: 'horizontalRule' }
	| { type: 'media'; attrs: { id: string } };
export type RichTextListItem = { type: 'listItem'; content: RichTextBlock[] };
export interface RichTextDoc {
	type: 'doc';
	content: RichTextBlock[];
}

/** Marks in canonical order (outermost first). Matches the editor schema's mark order. */
export const MARK_ORDER: readonly MarkType[] = [
	'link',
	'bold',
	'italic',
	'underline',
	'strike',
	'subscript',
	'superscript',
];

export interface Allowed {
	marks: Set<MarkType>;
	headings: Set<HeadingLevel>;
	/** Alignments that can be set (unset = the site's default). */
	aligns: Set<TextAlign>;
	bulletList: boolean;
	orderedList: boolean;
	blockquote: boolean;
	horizontalRule: boolean;
	media: boolean;
}

export function allowedFor(toolbar: readonly RichTextButton[] = DEFAULT_TOOLBAR): Allowed {
	const has = (b: RichTextButton) => toolbar.includes(b);
	return {
		marks: new Set<MarkType>(
			(['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'link'] as const).filter(has),
		),
		headings: new Set(HEADING_LEVELS.filter((l) => has(`heading${l}`))),
		aligns: new Set(TEXT_ALIGNS.filter((a) => has(ALIGN_BUTTON[a]))),
		bulletList: has('bulletList'),
		orderedList: has('orderedList'),
		blockquote: has('blockquote'),
		horizontalRule: has('horizontalRule'),
		media: has('media'),
	};
}

/**
 * Editor output in stored form: ProseMirror writes every attribute, including
 * an unset alignment (`textAlign: null`); stored values leave unset alignment
 * out. Applied to `Node.toJSON()` before values are stored or compared.
 */
export function stripDefaultAttrs<T>(json: T): T {
	if (Array.isArray(json)) return json.map((item) => stripDefaultAttrs(item)) as T;
	if (!isPlainObject(json)) return json;
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(json)) {
		if (key === 'attrs' && isPlainObject(value)) {
			const attrs = Object.fromEntries(Object.entries(value).filter(([k, v]) => !(k === 'textAlign' && v == null)));
			if (Object.keys(attrs).length > 0) out.attrs = attrs;
		} else {
			out[key] = stripDefaultAttrs(value);
		}
	}
	return out as T;
}

export function emptyRichText(): RichTextDoc {
	return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Paragraphs from plain text: blank lines separate paragraphs, single line
 * breaks become line breaks. This is how the old `textarea`-based Text
 * component displayed its content, so converting keeps pages looking the same.
 */
export function richTextFromPlain(text: string): RichTextDoc {
	const paragraphs = text
		.replace(/\r\n?/g, '\n')
		.split(/\n[ \t]*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (paragraphs.length === 0) return emptyRichText();
	return {
		type: 'doc',
		content: paragraphs.map((p) => {
			const content: RichTextInline[] = [];
			p.split('\n').forEach((line, i) => {
				if (i > 0) content.push({ type: 'hardBreak' });
				if (line) content.push({ type: 'text', text: line });
			});
			return { type: 'paragraph', content };
		}),
	};
}

/** The text of a value, blocks separated by blank lines (for summaries and search). */
export function richTextToPlain(doc: RichTextDoc): string {
	const blocks: string[] = [];
	const walk = (nodes: RichTextBlock[]) => {
		for (const node of nodes) {
			if (node.type === 'paragraph' || node.type === 'heading') {
				blocks.push((node.content ?? []).map((i) => (i.type === 'text' ? i.text : '\n')).join(''));
			} else if (node.type !== 'horizontalRule' && node.type !== 'media') {
				walk(node.content as RichTextBlock[]);
			}
		}
	};
	walk(doc.content);
	return blocks.join('\n\n');
}

/** True when the value has no text and no media (an editor would show an empty field). */
export function isRichTextEmpty(doc: RichTextDoc): boolean {
	const hasMedia = (nodes: RichTextBlock[]): boolean =>
		nodes.some(
			(n) =>
				n.type === 'media' ||
				('content' in n &&
					Array.isArray(n.content) &&
					n.type !== 'paragraph' &&
					n.type !== 'heading' &&
					hasMedia(n.content as RichTextBlock[])),
		);
	return richTextToPlain(doc).trim() === '' && !hasMedia(doc.content);
}

export interface CleanResult {
	/** The cleaned value; absent when the input can't be used at all (`problem` says why). */
	value?: RichTextDoc;
	problem?: string;
	/** True when formatting or structure had to be removed or repaired (not for plain-text conversion). */
	changed: boolean;
}

interface CleanState {
	allowed: Allowed;
	isSafeUrl: (url: string) => boolean;
	nodes: number;
	textLength: number;
	changed: boolean;
	tooDeep: boolean;
}

function cleanMarks(raw: unknown, state: CleanState): RichTextMark[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		state.changed = true;
		return [];
	}
	const byType = new Map<MarkType, RichTextMark>();
	for (const mark of raw) {
		const type = isPlainObject(mark) ? mark.type : undefined;
		if (typeof type !== 'string' || !(MARK_ORDER as readonly string[]).includes(type)) {
			state.changed = true;
			continue;
		}
		const markType = type as MarkType;
		if (!state.allowed.marks.has(markType) || byType.has(markType)) {
			state.changed = true;
			continue;
		}
		if (markType === 'link') {
			const href = isPlainObject(mark) && isPlainObject(mark.attrs) ? mark.attrs.href : undefined;
			if (typeof href !== 'string' || href.trim() === '' || !state.isSafeUrl(href)) {
				state.changed = true;
				continue;
			}
			byType.set('link', { type: 'link', attrs: { href } });
		} else {
			byType.set(markType, { type: markType } as RichTextMark);
		}
	}
	// Subscript and superscript exclude each other (as in the editor): keep the first.
	if (byType.has('subscript') && byType.has('superscript')) {
		byType.delete('superscript');
		state.changed = true;
	}
	return MARK_ORDER.filter((t) => byType.has(t)).map((t) => byType.get(t) as RichTextMark);
}

const sameMarks = (a: RichTextMark[] = [], b: RichTextMark[] = []) => JSON.stringify(a) === JSON.stringify(b);

function cleanInline(raw: unknown, state: CleanState): RichTextInline[] {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) {
		state.changed = true;
		return [];
	}
	const out: RichTextInline[] = [];
	for (const item of raw) {
		if (!isPlainObject(item)) {
			state.changed = true;
			continue;
		}
		if (item.type === 'hardBreak') {
			state.nodes++;
			out.push({ type: 'hardBreak' });
			continue;
		}
		if (item.type !== 'text' || typeof item.text !== 'string') {
			state.changed = true;
			continue;
		}
		if (item.text === '') {
			state.changed = true;
			continue;
		}
		const marks = cleanMarks(item.marks, state);
		state.textLength += item.text.length;
		const previous = out[out.length - 1];
		if (previous?.type === 'text' && sameMarks(previous.marks, marks)) {
			previous.text += item.text; // ProseMirror merges equal runs; stay identical to its output
			state.changed = true;
			continue;
		}
		state.nodes++;
		// Key order matches ProseMirror's toJSON() ({ type, marks, text }), because
		// documents are compared as JSON strings (e.g. draft vs published).
		out.push(marks.length > 0 ? { type: 'text', marks, text: item.text } : { type: 'text', text: item.text });
	}
	return out;
}

/** A paragraph; key order matches ProseMirror's toJSON() ({ type, attrs, content }). */
function textBlock(content: RichTextInline[], align?: TextAlign): RichTextBlock {
	const block: RichTextBlock = align ? { type: 'paragraph', attrs: { textAlign: align } } : { type: 'paragraph' };
	if (content.length > 0) block.content = content;
	return block;
}

/** The block's alignment if the toolbar allows it; unset otherwise. */
function alignOf(attrs: unknown, state: CleanState): TextAlign | undefined {
	const value = isPlainObject(attrs) ? attrs.textAlign : undefined;
	if (value === undefined || value === null) return undefined;
	if (TEXT_ALIGNS.includes(value as TextAlign) && state.allowed.aligns.has(value as TextAlign))
		return value as TextAlign;
	state.changed = true;
	return undefined;
}

function cleanBlocks(raw: unknown, depth: number, state: CleanState): RichTextBlock[] {
	if (!Array.isArray(raw)) {
		state.changed = true;
		return [];
	}
	if (depth > RICH_TEXT_LIMITS.maxDepth) {
		state.tooDeep = true;
		return [];
	}
	const out: RichTextBlock[] = [];
	for (const item of raw) {
		if (!isPlainObject(item)) {
			state.changed = true;
			continue;
		}
		state.nodes++;
		switch (item.type) {
			case 'paragraph':
				out.push(textBlock(cleanInline(item.content, state), alignOf(item.attrs, state)));
				break;
			case 'heading': {
				const level = isPlainObject(item.attrs) ? item.attrs.level : undefined;
				const content = cleanInline(item.content, state);
				const align = alignOf(item.attrs, state);
				if (HEADING_LEVELS.includes(level as HeadingLevel) && state.allowed.headings.has(level as HeadingLevel)) {
					const attrs = align ? { level: level as HeadingLevel, textAlign: align } : { level: level as HeadingLevel };
					out.push(content.length > 0 ? { type: 'heading', attrs, content } : { type: 'heading', attrs });
				} else {
					state.changed = true;
					out.push(textBlock(content, align));
				}
				break;
			}
			case 'horizontalRule':
				if (state.allowed.horizontalRule) out.push({ type: 'horizontalRule' });
				else state.changed = true;
				break;
			case 'media': {
				const id = isPlainObject(item.attrs) ? item.attrs.id : undefined;
				if (state.allowed.media && typeof id === 'string' && MEDIA_ID.test(id))
					out.push({ type: 'media', attrs: { id } });
				else state.changed = true;
				break;
			}
			case 'blockquote': {
				const content = cleanBlocks(item.content, depth + 1, state);
				if (state.allowed.blockquote) {
					out.push({ type: 'blockquote', content: content.length > 0 ? content : [{ type: 'paragraph' }] });
				} else {
					state.changed = true;
					out.push(...content);
				}
				break;
			}
			case 'bulletList':
			case 'orderedList': {
				const items: RichTextListItem[] = [];
				for (const li of Array.isArray(item.content) ? item.content : []) {
					if (!isPlainObject(li) || li.type !== 'listItem') {
						state.changed = true;
						continue;
					}
					state.nodes++;
					const content = cleanBlocks(li.content, depth + 1, state);
					// ProseMirror's list item content is "paragraph block*".
					if (content[0]?.type !== 'paragraph') {
						content.unshift({ type: 'paragraph' });
						state.changed = true;
					}
					items.push({ type: 'listItem', content });
				}
				if (!Array.isArray(item.content)) state.changed = true;
				if (state.allowed[item.type]) {
					if (items.length > 0) out.push({ type: item.type, content: items });
					else state.changed = true;
				} else {
					state.changed = true;
					for (const li of items) out.push(...li.content);
				}
				break;
			}
			default:
				state.changed = true;
		}
	}
	return out;
}

/**
 * Clean a stored `richtext` value against a field's toolbar. Never throws.
 *
 * - A string (e.g. content saved when the field was a `textarea`) is converted
 *   with `richTextFromPlain()`.
 * - Formatting the toolbar doesn't allow is removed (headings become
 *   paragraphs, lists and quotes are unwrapped), unsafe links are unlinked,
 *   unknown nodes are dropped; `changed` is then true.
 * - Values over the limits, or that aren't a rich text document at all, are
 *   rejected with a `problem`.
 */
export function cleanRichText(
	input: unknown,
	options: { toolbar?: readonly RichTextButton[]; maxLength?: number; isSafeUrl: (url: string) => boolean },
): CleanResult {
	const maxLength = options.maxLength ?? RICH_TEXT_LIMITS.maxLength;
	if (typeof input === 'string') {
		if (input.length > maxLength) return { problem: `must be at most ${maxLength} characters`, changed: false };
		return { value: richTextFromPlain(input), changed: false };
	}
	if (!isPlainObject(input) || input.type !== 'doc') {
		return { problem: 'must be rich text (a "doc" object) or a string', changed: false };
	}
	const state: CleanState = {
		allowed: allowedFor(options.toolbar),
		isSafeUrl: options.isSafeUrl,
		nodes: 0,
		textLength: 0,
		changed: false,
		tooDeep: false,
	};
	const content = cleanBlocks(input.content, 1, state);
	if (state.tooDeep) return { problem: `is nested deeper than ${RICH_TEXT_LIMITS.maxDepth} levels`, changed: false };
	if (state.nodes > RICH_TEXT_LIMITS.maxNodes) {
		return { problem: `has more than ${RICH_TEXT_LIMITS.maxNodes} parts`, changed: false };
	}
	if (state.textLength > maxLength) return { problem: `must be at most ${maxLength} characters`, changed: false };
	if (content.length === 0) {
		return { value: emptyRichText(), changed: true };
	}
	return { value: { type: 'doc', content }, changed: state.changed };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Every tag the renderer can emit. */
export const RICH_TEXT_TAGS = [
	'p',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'sub',
	'sup',
	'blockquote',
	'ul',
	'ol',
	'li',
	'br',
	'strong',
	'em',
	'u',
	's',
	'a',
] as const;

export type RichTextTag = (typeof RICH_TEXT_TAGS)[number];

/** A string is text (escaped when rendered); an element has an allowlisted tag. */
export type RenderNode =
	| string
	| { tag: RichTextTag | 'media'; attrs?: { href?: string; style?: string; id?: string }; children: RenderNode[] };

const MARK_TAG: Record<Exclude<MarkType, 'link'>, RichTextTag> = {
	bold: 'strong',
	italic: 'em',
	underline: 'u',
	strike: 's',
	subscript: 'sub',
	superscript: 'sup',
};

/** Only these exact style values are ever emitted (alignment from a fixed list). */
const alignStyle = (align: unknown) =>
	TEXT_ALIGNS.includes(align as TextAlign) ? { style: `text-align: ${align as TextAlign}` } : undefined;

function blockElement(tag: RichTextTag, align: unknown, children: RenderNode[]): RenderNode {
	const attrs = alignStyle(align);
	return attrs ? { tag, attrs, children } : { tag, children };
}

function renderInline(nodes: RichTextInline[] | undefined, isSafeUrl: (url: string) => boolean): RenderNode[] {
	const out: RenderNode[] = [];
	for (const node of nodes ?? []) {
		if (node.type === 'hardBreak') {
			out.push({ tag: 'br', children: [] });
			continue;
		}
		let current: RenderNode = node.text;
		// Innermost first, so the canonical first mark (link) ends up outermost.
		for (const mark of [...(node.marks ?? [])].reverse()) {
			if (mark.type === 'link') {
				if (isSafeUrl(mark.attrs.href)) current = { tag: 'a', attrs: { href: mark.attrs.href }, children: [current] };
			} else {
				current = { tag: MARK_TAG[mark.type], children: [current] };
			}
		}
		out.push(current);
	}
	return out;
}

function renderBlock(node: RichTextBlock, isSafeUrl: (url: string) => boolean): RenderNode {
	switch (node.type) {
		case 'paragraph':
			return blockElement('p', node.attrs?.textAlign, renderInline(node.content, isSafeUrl));
		case 'heading':
			return blockElement(`h${node.attrs.level}`, node.attrs.textAlign, renderInline(node.content, isSafeUrl));
		case 'horizontalRule':
			return { tag: 'hr', children: [] };
		case 'media':
			// Rendered by the media library's Media.astro (RichText.astro); the id is validated.
			return { tag: 'media', attrs: { id: node.attrs.id }, children: [] };
		case 'blockquote':
			return { tag: 'blockquote', children: renderBlocks(node.content, isSafeUrl) };
		case 'bulletList':
			return { tag: 'ul', children: renderBlocks(node.content, isSafeUrl) };
		case 'orderedList':
			return { tag: 'ol', children: renderBlocks(node.content, isSafeUrl) };
		case 'listItem':
			return { tag: 'li', children: renderBlocks(node.content, isSafeUrl) };
	}
}

function renderBlocks(nodes: RichTextBlock[], isSafeUrl: (url: string) => boolean): RenderNode[] {
	return nodes.map((node) => renderBlock(node, isSafeUrl));
}

/**
 * The render tree for a rich text value. Values are cleaned first (with every
 * button allowed: the validator has already applied the field's toolbar), so
 * this is safe to call on anything.
 */
export function toRenderTree(value: unknown, isSafeUrl: (url: string) => boolean): RenderNode[] {
	const cleaned = cleanRichText(value, { toolbar: RICH_TEXT_BUTTONS, isSafeUrl, maxLength: Number.POSITIVE_INFINITY });
	if (!cleaned.value || isRichTextEmpty(cleaned.value)) return [];
	return renderBlocks(cleaned.value.content, isSafeUrl);
}
