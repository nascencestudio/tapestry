/**
 * Tapestry core types.
 *
 * Two families of types live here:
 *
 * 1. **Component definitions**: what a developer registers. They describe an
 *    Astro component, the props an editor may set on it, and whether it accepts
 *    child components. See `defineComponent()` in `define.ts`.
 *
 * 2. **Documents**: what an editor produces. A document is a JSON tree of
 *    component instances that is stored as the StudioCMS page content string.
 *    See docs/data-model.md for the full specification.
 */

import type { RichTextButton, RichTextDoc } from './richtext.js';

export type {
	RichTextBlock,
	RichTextButton,
	RichTextDoc,
	RichTextInline,
	RichTextListItem,
	RichTextMark,
} from './richtext.js';

// ---------------------------------------------------------------------------
// Prop schema
// ---------------------------------------------------------------------------

interface PropBase {
	/** Human-readable label shown in the editor. */
	label: string;
	/** Optional help text shown under the field in the editor. */
	description?: string;
	/** When true, a document missing this prop fails validation. */
	required?: boolean;
}

export interface TextProp extends PropBase {
	type: 'text';
	default?: string;
	/** Maximum length in characters. Defaults to 500. */
	maxLength?: number;
}

export interface TextareaProp extends PropBase {
	type: 'textarea';
	default?: string;
	/** Maximum length in characters. Defaults to 10_000. */
	maxLength?: number;
}

export interface UrlProp extends PropBase {
	type: 'url';
	default?: string;
}

/**
 * A link stored in a `link` prop: a page on this site (by id, so it survives
 * slug changes) or a web address. Key order is canonical (`type`, then `page`
 * or `url`, then `newTab`).
 */
export type LinkValue = { type: 'page'; page: string; newTab?: true } | { type: 'url'; url: string; newTab?: true };

/**
 * A link: a page on this site, chosen from a list, or a web address (relative,
 * http(s), mailto or tel). Components receive a `ResolvedLink` (or `null` when
 * there's no link, or the page no longer exists). A plain string value is
 * accepted as a web address, so a `url` prop can become a `link` prop without
 * breaking stored content.
 */
export interface LinkProp extends PropBase {
	type: 'link';
	/** A web address (string) or a link value. */
	default?: string | LinkValue;
}

/** What a component receives for a `link` prop. */
export interface ResolvedLink {
	/** The URL to put in `href` (a page's current path, or the web address). */
	href: string;
	/** True for addresses outside the site (http(s) to another host, mailto, tel). */
	external: boolean;
	/** Open in a new tab (`target="_blank"`); `rel` is then "noopener noreferrer". */
	newTab: boolean;
	rel: string | undefined;
	/** For page links: the page's title (handy for labels); null for web addresses. */
	title: string | null;
}

export interface NumberProp extends PropBase {
	type: 'number';
	default?: number;
	min?: number;
	max?: number;
}

export interface BooleanProp extends PropBase {
	type: 'boolean';
	default?: boolean;
}

export interface SelectProp extends PropBase {
	type: 'select';
	options: ReadonlyArray<{ value: string; label: string }>;
	default?: string;
}

export interface RichTextProp extends PropBase {
	type: 'richtext';
	/** Plain text (blank lines separate paragraphs) or a rich text value. */
	default?: string | RichTextDoc;
	/** Maximum length in characters of text (formatting isn't counted). Defaults to 20_000. */
	maxLength?: number;
	/**
	 * Formatting buttons editors get, in toolbar order. Also the allowlist:
	 * formatting not listed here is removed from stored and pasted content.
	 * Defaults to bold, italic, link, bulleted list, numbered list.
	 */
	toolbar?: readonly RichTextButton[];
	/** Kinds the toolbar's "Insert media" button can choose (with `media` in the toolbar). Default: all. */
	mediaAccept?: readonly MediaKind[];
}

/** Kinds of media item (from @nascencestudio/medialibrary). */
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'remoteVideo';
export const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'document', 'remoteVideo'];

/**
 * A media item chosen from the media library (@nascencestudio/medialibrary).
 * The document stores the item's id; components receive the item itself
 * (`MediaItem`), or `null` if it was deleted or the library isn't installed.
 */
export interface MediaProp extends PropBase {
	type: 'media';
	/** Kinds that can be chosen. Default: images only. */
	accept?: readonly MediaKind[];
	default?: never;
}

/** What a component receives for a `media` prop (same shape as the media library's items). */
export interface MediaItem {
	id: string;
	kind: MediaKind;
	name: string;
	alt: string;
	mime: string;
	size: number;
	width: number | null;
	height: number | null;
	/** Public URL of the file, or the remote video's page. */
	url: string;
	/** Remote videos: the embed URL. */
	embedUrl: string | null;
	thumbnailUrl: string | null;
	provider: 'youtube' | 'vimeo' | null;
	createdAt: string;
	updatedAt: string;
	createdBy: string | null;
	/** Tags (lowercase). */
	tags: string[];
	/** Images: the spot to keep when cropping, in percent (null: the center). */
	focalPoint: { x: number; y: number } | null;
	/** Uploaded videos: caption and subtitle tracks (WebVTT). */
	tracks: Array<{ id: string; kind: 'subtitles' | 'captions'; srclang: string; label: string; url: string }>;
	/** Raster images: resized copies (WebP), narrowest first. */
	variants: Array<{ url: string; width: number; height: number; mime: string }>;
	/** Images: a `srcset` with the variants and the original, or null. */
	srcset: string | null;
}

/** Prop types that hold one value. They're also the fields of `object` and `list` props. */
export type FieldDefinition =
	| TextProp
	| TextareaProp
	| UrlProp
	| NumberProp
	| BooleanProp
	| SelectProp
	| RichTextProp
	| MediaProp
	| LinkProp;

/**
 * A group of fields edited together (e.g. a call to action: label + link).
 * Components receive an object with the fields' values (media and links
 * resolved like props), or `undefined` when no field is set. Fields can't be
 * objects or lists themselves.
 */
export interface ObjectProp extends PropBase {
	type: 'object';
	/** The fields, in form order. Names follow the prop name rules. */
	fields: Record<string, FieldDefinition>;
	default?: ObjectValue;
}

/**
 * A repeater: a list of items with the same fields (FAQ entries, cards, logos).
 * Editors add, remove and reorder items. Components receive an array of
 * objects (media and links resolved), or `undefined` when the list is empty.
 */
export interface ListProp extends PropBase {
	type: 'list';
	/** Each item's fields, in form order. Names follow the prop name rules. */
	fields: Record<string, FieldDefinition>;
	/** Fewest items (default 0; `required` means at least 1). */
	minItems?: number;
	/** Most items (default 50, at most 100). */
	maxItems?: number;
	/** What one item is called in the editor ("question" → "Add question"). Default "item". */
	itemLabel?: string;
	default?: readonly ObjectValue[];
}

export type PropDefinition = FieldDefinition | ObjectProp | ListProp;

export type PropType = PropDefinition['type'];

// ---------------------------------------------------------------------------
// Component definitions
// ---------------------------------------------------------------------------

export interface ComponentDefinition {
	/**
	 * Unique component type. Also used as the HTML custom-element tag that the
	 * StudioCMS component registry swaps for the Astro component, so it must be
	 * a valid custom element name: lowercase, starts with a letter, contains a
	 * hyphen. Example: `tapestry-hero`.
	 */
	type: string;
	/** Label shown in the editor's component library. */
	label: string;
	/** Short description shown in the editor's component library. */
	description?: string;
	/** Optional grouping in the component library, e.g. "Layout". */
	category?: string;
	/**
	 * Path to the component, relative to the Astro project root, e.g.
	 * `./src/components/tapestry/Hero.astro`. Usually an `.astro` file; a
	 * framework component (`.tsx`, `.jsx`, `.svelte`, `.vue`) works too when the
	 * site has that framework's Astro integration.
	 */
	component: string;
	/**
	 * Make a framework component interactive in the browser (an Astro island):
	 * `'load'` (right away), `'idle'` (when the browser is idle) or `'visible'`
	 * (when it scrolls into view). Without it, the component renders to plain
	 * HTML and ships no JavaScript. Not for `.astro` components (they can use
	 * islands inside themselves).
	 */
	client?: ClientDirective;
	/**
	 * Optional picture for the editor's component library: an image file
	 * (`.png`, `.jpg`, `.webp`, `.avif`, `.gif` or `.svg`), relative to the Astro
	 * project root like `component`. Without one, the library still shows a live
	 * preview on hover.
	 */
	thumbnail?: string;
	/**
	 * The component's version (default 1). Raise it when stored props need to change
	 * shape (a renamed prop, a new format), and add a migration for the new version in
	 * `migrations`. Pages saved with an older version are upgraded when they're read.
	 */
	version?: number;
	/**
	 * Path to a module (`.js`, `.mjs` or `.ts`, relative to the project root) whose
	 * default export maps versions to prop migrations: `{ 2: (props) => newProps }`.
	 * Each runs on a copy of the props saved with the version before it. Runs on the
	 * server and in the editor, so keep it plain JavaScript without side effects.
	 */
	migrations?: string;
	/**
	 * Lowest StudioCMS role that may add, change, move or remove this component
	 * (default `'editor'`: everyone who can edit). For others it's locked:
	 * read-only in the editor, and the server refuses saves that change it.
	 */
	permission?: 'editor' | 'admin' | 'owner';
	/** Types this component was called before (stored nodes with those types become this one). */
	replaces?: readonly string[];
	/** Props the editor can set. Props not listed here are never rendered. */
	props?: Record<string, PropDefinition>;
	/**
	 * Whether this component accepts child components in its default area.
	 * They're rendered into the component's default `<slot />`.
	 */
	acceptsChildren?: boolean;
	/**
	 * Named areas that hold child components (e.g. `left` and `right` of a
	 * two-column layout), in the order editors see them. Each is rendered into
	 * the component's `<slot name="…" />`. Names follow the prop name rules.
	 */
	slots?: Record<string, SlotDefinition>;
}

/** When an interactive (framework) component loads its JavaScript. */
export type ClientDirective = 'load' | 'idle' | 'visible';
export const CLIENT_DIRECTIVES: readonly ClientDirective[] = ['load', 'idle', 'visible'];

/** A named area of a component that holds child components. */
export interface SlotDefinition {
	/** Shown in the page structure and on the canvas ("Left column"). */
	label: string;
	description?: string;
}

/**
 * The browser- and runtime-safe subset of a component definition. It omits the
 * file path, which is only needed at build time.
 */
export type ComponentManifestEntry = Omit<ComponentDefinition, 'component' | 'thumbnail' | 'migrations'> & {
	/** The prop migrations by version, loaded from `migrations` at runtime (not JSON). */
	migrate?: Readonly<Record<number, PropsMigration>>;
};

/** Upgrades a node's props from the previous component version to this one. */
export type PropsMigration = (props: Record<string, unknown>) => Record<string, unknown>;

/** All registered components keyed by `type`. */
export type ComponentManifest = Record<string, ComponentManifestEntry>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** A value of a single-value prop (or of a field in an object or list). */
export type FieldValue = string | number | boolean | RichTextDoc | LinkValue;

/** An `object` prop's value, or one `list` item: field values by field name. */
export type ObjectValue = { [field: string]: FieldValue };

/** A prop value as stored in a document. */
export type PropValue = FieldValue | ObjectValue | ObjectValue[];

/** One component instance in the page tree. */
export interface TapestryNode {
	/** Stable unique id within the document (used by the editor for selection). */
	id: string;
	/** Must match a registered `ComponentDefinition.type`. */
	type: string;
	/**
	 * Optional editor-only name shown in the page structure ("Hero – pricing").
	 * Never rendered. Plain text, at most `LIMITS.labelMaxLength` characters.
	 */
	label?: string;
	/** The component version the props were saved with (absent: 1). See `ComponentDefinition.version`. */
	version?: number;
	/**
	 * The parent's named slot this node is in (absent: the parent's default
	 * area). Children are kept grouped by slot, default area first, then the
	 * slots in the order the parent's definition lists them.
	 */
	slot?: string;
	/** Prop values keyed by prop name. */
	props: Record<string, PropValue>;
	/** Child nodes. Only allowed when the component sets `acceptsChildren` or has `slots`. */
	children?: TapestryNode[];
}

/** The root of a stored page. Serialized as JSON into the StudioCMS page content. */
export interface TapestryDocument {
	/** Format version, so stored pages can be migrated later. */
	version: 1;
	/** Top-level nodes, rendered in order. */
	root: TapestryNode[];
}
