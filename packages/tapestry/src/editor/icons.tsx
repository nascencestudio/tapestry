/**
 * Toolbar icons for the rich text editor: small inline SVGs drawn for Tapestry
 * (no icon font or library), 16×16, using `currentColor`. Typographic buttons
 * (bold, italic…) use styled letters instead; see `GLYPHS`. `UI_ICONS` are the
 * editor's own controls (page structure, hints), drawn the same way.
 */
import type { JSX } from 'preact';

const line = {
	fill: 'none',
	stroke: 'currentColor',
	'stroke-width': 1.5,
	'stroke-linecap': 'round',
	'stroke-linejoin': 'round',
} as const;

function Svg({ children }: { children: JSX.Element | JSX.Element[] }) {
	return (
		<svg class="tp-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
			{children}
		</svg>
	);
}

/** Four lines, with the widths that show an alignment. */
const alignLines = (rows: Array<[number, number]>) => (
	<Svg>
		{rows.map(([x1, x2], i) => (
			<path key={i} {...line} d={`M${x1} ${3.5 + i * 3}H${x2}`} />
		))}
	</Svg>
);

export const ICONS = {
	link: (
		<Svg>
			<path {...line} d="M6.5 9.5l3-3" />
			<path {...line} d="M7.25 4.75l1-1a2.47 2.47 0 0 1 3.5 3.5l-1 1" />
			<path {...line} d="M8.75 11.25l-1 1a2.47 2.47 0 0 1-3.5-3.5l1-1" />
		</Svg>
	),
	bulletList: (
		<Svg>
			<circle cx="3" cy="4" r="1.1" fill="currentColor" />
			<circle cx="3" cy="8" r="1.1" fill="currentColor" />
			<circle cx="3" cy="12" r="1.1" fill="currentColor" />
			<path {...line} d="M6.5 4H14M6.5 8H14M6.5 12H14" />
		</Svg>
	),
	orderedList: (
		<Svg>
			<path {...line} stroke-width="1.2" d="M2.2 2.8l1-.6v3.6" />
			<path {...line} stroke-width="1.2" d="M2 7.2c.3-.6 1.9-.7 1.9.3 0 .7-1.9 1.5-1.9 2.3h2" />
			<path
				{...line}
				stroke-width="1.2"
				d="M2 11.6c.4-.5 1.9-.5 1.9.4 0 .5-.5.7-1 .7.5 0 1.1.2 1.1.8 0 .9-1.6 1-2 .4"
			/>
			<path {...line} d="M6.5 4H14M6.5 8H14M6.5 12H14" />
		</Svg>
	),
	blockquote: (
		<Svg>
			<path fill="currentColor" d="M2 7.5h4v4.5H2zM9 7.5h4v4.5H9z" />
			<path {...line} d="M2.75 8.5c0-2.5 1-4 3-4.5M9.75 8.5c0-2.5 1-4 3-4.5" />
		</Svg>
	),
	horizontalRule: (
		<Svg>
			<path {...line} d="M2 8h12" />
			<path {...line} stroke-width="1" opacity="0.45" d="M4 4.5h8M4 11.5h8" />
		</Svg>
	),
	media: (
		<Svg>
			<rect {...line} x="2" y="3" width="12" height="10" rx="1.5" />
			<circle cx="10.5" cy="6" r="1.1" fill="currentColor" />
			<path {...line} d="M2.5 11.5l3.5-3.5 2.5 2.5 1.5-1.5 3.5 3.5" />
		</Svg>
	),
	clearFormatting: (
		<Svg>
			<path {...line} d="M3 3.5h7M6.5 3.5v9" />
			<path {...line} d="M10 9.5l3.5 3.5M13.5 9.5L10 13" />
		</Svg>
	),
	alignLeft: alignLines([
		[2, 14],
		[2, 10],
		[2, 14],
		[2, 10],
	]),
	alignCenter: alignLines([
		[2, 14],
		[4, 12],
		[2, 14],
		[4, 12],
	]),
	alignRight: alignLines([
		[2, 14],
		[6, 14],
		[2, 14],
		[6, 14],
	]),
	alignJustify: alignLines([
		[2, 14],
		[2, 14],
		[2, 14],
		[2, 14],
	]),
	chevron: (
		<svg class="tp-icon tp-icon--chevron" viewBox="0 0 10 10" width="8" height="8" aria-hidden="true" focusable="false">
			<path {...line} d="M2 3.5l3 3 3-3" />
		</svg>
	),
} satisfies Record<string, JSX.Element>;

/** Letter "icons" for typographic buttons (rendered with `.tp-glyph` styles). */
export const GLYPHS = {
	bold: { text: 'B', className: 'tp-glyph--bold' },
	italic: { text: 'I', className: 'tp-glyph--italic' },
	underline: { text: 'U', className: 'tp-glyph--underline' },
	strike: { text: 'S', className: 'tp-glyph--strike' },
	subscript: { text: 'X₂', className: '' },
	superscript: { text: 'X²', className: '' },
} as const;

/** A text-style "icon": P, H1…H6. */
export function StyleGlyph({ level }: { level: number }) {
	return (
		<span class="tp-glyph tp-glyph--style" aria-hidden="true">
			{level === 0 ? 'P' : `H${level}`}
		</span>
	);
}

/** Icons for the editor's own controls, 16×16, `currentColor`. */
export const UI_ICONS = {
	/** Two chevrons pointing together: collapse everything. */
	collapseAll: (
		<Svg>
			<path {...line} d="M4.5 2.5L8 6l3.5-3.5" />
			<path {...line} d="M4.5 13.5L8 10l3.5 3.5" />
		</Svg>
	),
	/** Two chevrons pointing apart: expand everything. */
	expandAll: (
		<Svg>
			<path {...line} d="M4.5 6L8 2.5L11.5 6" />
			<path {...line} d="M4.5 10L8 13.5L11.5 10" />
		</Svg>
	),
	info: (
		<Svg>
			<circle {...line} cx="8" cy="8" r="6.25" />
			<path {...line} d="M8 7.25v4" />
			<circle cx="8" cy="4.9" r="0.9" fill="currentColor" />
		</Svg>
	),
	close: (
		<Svg>
			<path {...line} d="M4 4l8 8M12 4l-8 8" />
		</Svg>
	),
	/** Page structure: a container that's open (rotated by CSS when collapsed). */
	chevron: (
		<Svg>
			<path {...line} stroke-width={2} d="M4 6l4 4 4-4" />
		</Svg>
	),
	/** A locked component (ADR 0033). */
	lock: (
		<Svg>
			<rect {...line} x="3.25" y="7.25" width="9.5" height="6.5" rx="1.5" />
			<path {...line} d="M5.5 7.25V5a2.5 2.5 0 0 1 5 0v2.25" />
		</Svg>
	),
	/** Translations. */
	globe: (
		<Svg>
			<circle {...line} cx="8" cy="8" r="6.25" />
			<path {...line} d="M1.75 8h12.5" />
			<path
				{...line}
				d="M8 1.75c1.75 1.75 2.6 3.85 2.6 6.25S9.75 12.5 8 14.25C6.25 12.5 5.4 10.4 5.4 8S6.25 3.5 8 1.75z"
			/>
		</Svg>
	),
	/** Page structure: a component without children. */
	dot: (
		<Svg>
			<circle cx="8" cy="8" r="3.5" fill="currentColor" />
		</Svg>
	),
} satisfies Record<string, JSX.Element>;
