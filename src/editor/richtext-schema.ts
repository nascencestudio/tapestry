/**
 * ProseMirror schema for one `richtext` field, built from its toolbar. Nodes
 * and marks the toolbar doesn't enable don't exist in the schema, so they
 * can't be typed, pasted or dropped in. `stripDefaultAttrs(Node.toJSON())`
 * matches the stored format in ../richtext.ts.
 */
import { type MarkSpec, type NodeSpec, Schema } from 'prosemirror-model';
import { allowedFor, DEFAULT_TOOLBAR, MEDIA_ID, type RichTextButton, type TextAlign } from '../richtext.js';
import { isSafeUrl } from '../validate.js';

const cache = new Map<string, Schema>();

export function schemaFor(toolbar: readonly RichTextButton[] = DEFAULT_TOOLBAR): Schema {
	const allowed = allowedFor(toolbar);
	// Keyed by what's allowed (not the button list), so fields whose toolbars only
	// differ in action buttons share one schema, and documents move between them.
	const key = JSON.stringify([
		[...allowed.marks].sort(),
		[...allowed.headings].sort(),
		[...allowed.aligns].sort(),
		allowed.bulletList,
		allowed.orderedList,
		allowed.blockquote,
		allowed.horizontalRule,
		allowed.media,
	]);
	const cached = cache.get(key);
	if (cached) return cached;

	// Alignment is an attribute of paragraphs and headings, present only when the
	// toolbar allows some alignment. Unset (null) means the site's default.
	const aligned = allowed.aligns.size > 0;
	const alignFrom = (dom: HTMLElement): TextAlign | null => {
		const value = dom.style.textAlign as TextAlign;
		return allowed.aligns.has(value) ? value : null;
	};
	const alignStyle = (align: TextAlign | null): Record<string, string> =>
		align ? { style: `text-align: ${align}` } : {};

	const nodes: Record<string, NodeSpec> = {
		doc: { content: 'block+' },
		paragraph: aligned
			? {
					attrs: { textAlign: { default: null } },
					content: 'inline*',
					group: 'block',
					parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ textAlign: alignFrom(dom as HTMLElement) }) }],
					toDOM: (node) => ['p', alignStyle(node.attrs.textAlign), 0],
				}
			: { content: 'inline*', group: 'block', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
	};
	if (allowed.headings.size > 0) {
		const levels = [...allowed.headings];
		nodes.heading = {
			attrs: aligned
				? { level: { default: levels[0] }, textAlign: { default: null } }
				: { level: { default: levels[0] } },
			content: 'inline*',
			group: 'block',
			defining: true,
			parseDOM: levels.map((level) => ({
				tag: `h${level}`,
				getAttrs: (dom) => (aligned ? { level, textAlign: alignFrom(dom as HTMLElement) } : { level }),
			})),
			toDOM: (node) => [`h${node.attrs.level}`, aligned ? alignStyle(node.attrs.textAlign) : {}, 0],
		};
	}
	if (allowed.blockquote) {
		nodes.blockquote = {
			content: 'block+',
			group: 'block',
			defining: true,
			parseDOM: [{ tag: 'blockquote' }],
			toDOM: () => ['blockquote', 0],
		};
	}
	if (allowed.horizontalRule) {
		nodes.horizontalRule = { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] };
	}
	if (allowed.media) {
		// A media library item, by id. The editor shows a preview (node view); the site renders it with Media.astro.
		nodes.media = {
			group: 'block',
			atom: true,
			draggable: true,
			attrs: { id: {} },
			parseDOM: [
				{
					tag: 'figure[data-media-id]',
					getAttrs: (dom) => {
						const id = (dom as HTMLElement).getAttribute('data-media-id') ?? '';
						return MEDIA_ID.test(id) ? { id } : false;
					},
				},
			],
			toDOM: (node) => ['figure', { 'data-media-id': node.attrs.id, class: 'tp-media-node' }],
		};
	}
	if (allowed.bulletList || allowed.orderedList) {
		nodes.listItem = { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] };
	}
	if (allowed.bulletList) {
		nodes.bulletList = { content: 'listItem+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] };
	}
	if (allowed.orderedList) {
		nodes.orderedList = { content: 'listItem+', group: 'block', parseDOM: [{ tag: 'ol' }], toDOM: () => ['ol', 0] };
	}
	nodes.text = { group: 'inline' };
	nodes.hardBreak = {
		inline: true,
		group: 'inline',
		selectable: false,
		parseDOM: [{ tag: 'br' }],
		toDOM: () => ['br'],
	};

	// Order matters: it's the canonical mark order (MARK_ORDER in richtext.ts).
	const marks: Record<string, MarkSpec> = {};
	if (allowed.marks.has('link')) {
		marks.link = {
			attrs: { href: {} },
			inclusive: false,
			parseDOM: [
				{
					tag: 'a[href]',
					getAttrs: (dom) => {
						const href = (dom as HTMLElement).getAttribute('href') ?? '';
						return href && isSafeUrl(href) ? { href } : false;
					},
				},
			],
			// No navigation from inside the editor; the href is shown on hover.
			toDOM: (mark) => ['a', { href: mark.attrs.href, title: mark.attrs.href, rel: 'noopener noreferrer' }, 0],
		};
	}
	if (allowed.marks.has('bold')) {
		marks.bold = {
			parseDOM: [
				{ tag: 'strong' },
				// Google Docs wraps everything in <b style="font-weight:normal">.
				{ tag: 'b', getAttrs: (dom) => (dom as HTMLElement).style.fontWeight !== 'normal' && null },
				{ style: 'font-weight', getAttrs: (value) => /^(bold(er)?|[6-9]\d{2,})$/.test(value as string) && null },
			],
			toDOM: () => ['strong', 0],
		};
	}
	if (allowed.marks.has('italic')) {
		marks.italic = {
			parseDOM: [{ tag: 'em' }, { tag: 'i' }, { style: 'font-style=italic' }],
			toDOM: () => ['em', 0],
		};
	}
	if (allowed.marks.has('underline')) {
		marks.underline = { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] };
	}
	if (allowed.marks.has('strike')) {
		marks.strike = {
			parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }],
			toDOM: () => ['s', 0],
		};
	}
	// Subscript and superscript exclude each other.
	if (allowed.marks.has('subscript')) {
		marks.subscript = {
			...(allowed.marks.has('superscript') ? { excludes: 'superscript' } : {}),
			parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }],
			toDOM: () => ['sub', 0],
		};
	}
	if (allowed.marks.has('superscript')) {
		marks.superscript = {
			...(allowed.marks.has('subscript') ? { excludes: 'subscript' } : {}),
			parseDOM: [{ tag: 'sup' }, { style: 'vertical-align=super' }],
			toDOM: () => ['sup', 0],
		};
	}

	const schema = new Schema({ nodes, marks });
	cache.set(key, schema);
	return schema;
}
