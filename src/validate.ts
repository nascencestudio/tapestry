import { migrateComponentProps, migrateFormat, resolveType } from './migrations.js';
import { cleanRichText, isRichTextEmpty, MEDIA_ID } from './richtext.js';
import { canonicalNode, hasArea, hasChildAreas, sortByArea } from './slots.js';

export { MEDIA_ID };

import type {
	ComponentManifest,
	ComponentManifestEntry,
	FieldValue,
	LinkValue,
	ListProp,
	ObjectValue,
	PropDefinition,
	PropValue,
	TapestryDocument,
	TapestryNode,
} from './types.js';

/**
 * Hard limits that bound the cost of parsing and rendering one page. They
 * protect the server from oversized or maliciously deep content.
 */
export const LIMITS = {
	/** Maximum size of the stored JSON string, in characters. */
	maxContentLength: 1_000_000,
	/** Maximum nesting depth of the component tree. */
	maxDepth: 32,
	/** Maximum number of nodes in one document. */
	maxNodes: 2_000,
	/** Default `maxLength` for `text` props. */
	textMaxLength: 500,
	/** Default `maxLength` for `textarea` props. */
	textareaMaxLength: 10_000,
	/** Maximum length of a `url` prop. */
	urlMaxLength: 2_048,
	/** Maximum length of a node's editor-only `label`. */
	labelMaxLength: 60,
	/** Default `maxItems` for `list` props. */
	listDefaultMaxItems: 50,
	/** Largest `maxItems` a `list` prop may declare. */
	listMaxItems: 100,
} as const;

const NODE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** URL schemes allowed in `url` props. Anything else (javascript:, data:, …) is rejected. */
const SAFE_URL_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export interface ValidationIssue {
	/** `error` drops the offending node or prop; `warning` is informational. */
	severity: 'error' | 'warning';
	/** JSON-path-like location, e.g. `root[2].children[0].props.heading`. */
	path: string;
	message: string;
}

export interface ValidationResult {
	/**
	 * A cleaned document containing only valid nodes and props, with defaults
	 * filled in. It is always present, so a page with one broken component
	 * still renders everything else.
	 */
	document: TapestryDocument;
	issues: ValidationIssue[];
	/** True when there are no `error` issues. */
	valid: boolean;
}

/** The document an empty page starts with. */
export function emptyDocument(): TapestryDocument {
	return { version: 1, root: [] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/**
 * Returns true if `value` is a URL safe to put in an `href`/`src`: a relative
 * reference or an absolute URL with an allowed scheme.
 */
export function isSafeUrl(value: string): boolean {
	if (value.length > LIMITS.urlMaxLength) return false;
	// Browsers ignore ASCII whitespace and control characters when parsing a
	// scheme ("java\tscript:"), so strip them before checking.
	// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
	const compact = value.replace(/[\u0000- \u007f]/g, '');
	const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
	if (!scheme) return true; // relative URL: "/about", "#top", "page?x=1"
	return SAFE_URL_SCHEMES.has(`${scheme[1]?.toLowerCase()}:`);
}

/**
 * Validate one prop value against its definition. Returns a human-readable
 * error message (e.g. "must be at most 50 characters") or null if valid.
 */
export function validatePropValue(def: PropDefinition, value: unknown): string | null {
	switch (def.type) {
		case 'text':
		case 'textarea': {
			if (typeof value !== 'string') return 'must be a string';
			const max = def.maxLength ?? (def.type === 'text' ? LIMITS.textMaxLength : LIMITS.textareaMaxLength);
			return value.length > max ? `must be at most ${max} characters` : null;
		}
		case 'url':
			if (typeof value !== 'string') return 'must be a string';
			return isSafeUrl(value) ? null : 'must be a relative URL or use http, https, mailto or tel';
		case 'number':
			if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
			if (def.min !== undefined && value < def.min) return `must be at least ${def.min}`;
			if (def.max !== undefined && value > def.max) return `must be at most ${def.max}`;
			return null;
		case 'boolean':
			return typeof value === 'boolean' ? null : 'must be true or false';
		case 'select':
			if (typeof value !== 'string') return 'must be a string';
			return def.options.some((o) => o.value === value) ? null : 'is not one of the allowed options';
		case 'media':
			if (typeof value !== 'string') return 'must be a media item id';
			return MEDIA_ID.test(value) ? null : 'is not a valid media item id';
		case 'richtext': {
			const cleaned = cleanRichTextProp(def, value);
			if (!cleaned.value) return cleaned.problem ?? 'is not valid rich text';
			return cleaned.changed ? 'contains formatting that is not allowed here' : null;
		}
		case 'link': {
			const link = cleanLinkValue(value);
			if (!link) return 'must be a page on this site or a web address (relative, http, https, mailto or tel)';
			return JSON.stringify(link) === JSON.stringify(value) ? null : 'is not in the stored link format';
		}
		case 'object':
		case 'list': {
			const issues: ValidationIssue[] = [];
			const cleaned = cleanValue(def, value, '', issues);
			const error = issues.find((issue) => issue.severity === 'error');
			if (error) return error.path ? `${error.path.replace(/^\./, '')} ${error.message}` : error.message;
			if (cleaned === undefined) return def.type === 'list' ? 'has no items' : 'has no fields set';
			return JSON.stringify(cleaned) === JSON.stringify(value) ? null : 'is not in the stored format';
		}
	}
}

/** Page ids in link values (StudioCMS uses UUIDs; any id-like string is accepted). */
const PAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * A `link` prop value in canonical form, or null if it isn't one. A string is
 * read as a web address (the `url` prop's format), so `url` props can become
 * `link` props.
 */
export function cleanLinkValue(value: unknown): LinkValue | null {
	if (typeof value === 'string') {
		return value.length <= LIMITS.urlMaxLength && isSafeUrl(value) ? { type: 'url', url: value } : null;
	}
	if (!isPlainObject(value)) return null;
	const newTab = value.newTab === true ? ({ newTab: true } as const) : {};
	if (value.type === 'page' && typeof value.page === 'string' && PAGE_ID.test(value.page)) {
		return { type: 'page', page: value.page, ...newTab };
	}
	if (
		value.type === 'url' &&
		typeof value.url === 'string' &&
		value.url.length <= LIMITS.urlMaxLength &&
		isSafeUrl(value.url)
	) {
		return { type: 'url', url: value.url, ...newTab };
	}
	return null;
}

/** A prop's declared default in stored form (rich text defaults may be plain strings). Always a fresh copy. */
export function defaultValue(def: PropDefinition): PropValue | undefined {
	if (def.default === undefined) return undefined;
	if (def.type === 'richtext') return cleanRichTextProp(def, def.default).value;
	if (def.type === 'link') return cleanLinkValue(def.default) ?? undefined;
	if (def.type === 'object' || def.type === 'list') return cleanValue(def, def.default, '', []) ?? undefined;
	return def.default;
}

/**
 * Clean one value against its definition. Returns the stored form, `undefined`
 * for no value (missing, or empty after cleaning), or `null` when it's invalid
 * (an error is recorded at `path`).
 */
function cleanValue(
	def: PropDefinition,
	raw: unknown,
	path: string,
	issues: ValidationIssue[],
): PropValue | undefined | null {
	if (raw === undefined) return undefined;
	let value = raw;
	switch (def.type) {
		case 'richtext': {
			// Rich text is cleaned rather than rejected: disallowed formatting is
			// removed and the text kept. Plain strings (from a former textarea) convert.
			const cleaned = cleanRichTextProp(def, value);
			if (cleaned.value) {
				if (cleaned.changed) {
					issues.push({ severity: 'warning', path, message: 'formatting that is not allowed here was removed' });
				}
				if (isRichTextEmpty(cleaned.value)) return undefined;
				value = cleaned.value;
			}
			break;
		}
		case 'link':
			// Strings (from a former `url` prop) and non-canonical objects convert.
			value = cleanLinkValue(value) ?? value;
			break;
		case 'object':
			return cleanObject(def.fields, value, path, issues);
		case 'list':
			return cleanList(def, value, path, issues);
	}
	const problem = validatePropValue(def, value);
	if (problem) {
		issues.push({ severity: 'error', path, message: problem });
		return null;
	}
	return value as PropValue;
}

/**
 * The value for one prop or field: the cleaned value, else the default.
 * `drop` when it's required and missing or invalid (the node, object or list
 * item holding it is then dropped).
 */
function cleanSlot(
	def: PropDefinition,
	raw: unknown,
	path: string,
	issues: ValidationIssue[],
): { value: PropValue | undefined; drop: boolean } {
	const value = cleanValue(def, raw, path, issues);
	if (value !== undefined && value !== null) return { value, drop: false };
	if (def.default !== undefined) return { value: defaultValue(def), drop: false };
	if (def.required) {
		if (value === undefined) issues.push({ severity: 'error', path, message: 'is required' });
		return { value: undefined, drop: true };
	}
	return { value: undefined, drop: false };
}

/** An `object` value or `list` item: fields in definition order; undefined when none is set. */
function cleanObject(
	fields: Record<string, PropDefinition>,
	raw: unknown,
	path: string,
	issues: ValidationIssue[],
): ObjectValue | undefined | null {
	if (!isPlainObject(raw)) {
		issues.push({ severity: 'error', path, message: 'must be an object' });
		return null;
	}
	for (const name of Object.keys(raw)) {
		if (!Object.hasOwn(fields, name)) {
			issues.push({ severity: 'warning', path: `${path}.${name}`, message: 'unknown field; it will be ignored' });
		}
	}
	const out: ObjectValue = {};
	for (const [name, field] of Object.entries(fields)) {
		const slot = cleanSlot(field, Object.hasOwn(raw, name) ? raw[name] : undefined, `${path}.${name}`, issues);
		if (slot.drop) return null;
		if (slot.value !== undefined) out[name] = slot.value as FieldValue;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** The most items a list prop keeps. */
export const listMaxItems = (def: ListProp) =>
	Math.min(def.maxItems ?? LIMITS.listDefaultMaxItems, LIMITS.listMaxItems);

/** A `list` value: valid items in order (empty and invalid ones dropped); undefined when empty. */
function cleanList(
	def: ListProp,
	raw: unknown,
	path: string,
	issues: ValidationIssue[],
): ObjectValue[] | undefined | null {
	if (!Array.isArray(raw)) {
		issues.push({ severity: 'error', path, message: 'must be a list' });
		return null;
	}
	const max = listMaxItems(def);
	const items: ObjectValue[] = [];
	for (const [index, item] of raw.entries()) {
		const itemPath = `${path}[${index}]`;
		if (items.length >= max) {
			issues.push({ severity: 'error', path: itemPath, message: `more than ${max} items; the rest are ignored` });
			break;
		}
		// An item with nothing filled in (e.g. added and left) is removed quietly, even with required fields.
		const blank = isPlainObject(item) && Object.keys(def.fields).every((name) => item[name] === undefined);
		const value = blank ? undefined : cleanObject(def.fields, item, itemPath, issues);
		if (value === undefined) {
			issues.push({ severity: 'warning', path: itemPath, message: 'empty item removed' });
		} else if (value !== null) {
			items.push(value);
		}
	}
	const min = def.minItems ?? 0;
	if (items.length < min) {
		issues.push({ severity: 'error', path, message: `needs at least ${min} item${min === 1 ? '' : 's'}` });
		return null;
	}
	return items.length > 0 ? items : undefined;
}

/** Clean a `richtext` prop value against its definition (toolbar, length). */
export function cleanRichTextProp(def: Extract<PropDefinition, { type: 'richtext' }>, value: unknown) {
	return cleanRichText(value, {
		...(def.toolbar ? { toolbar: def.toolbar } : {}),
		...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
		isSafeUrl,
	});
}

interface WalkState {
	manifest: ComponentManifest;
	issues: ValidationIssue[];
	ids: Set<string>;
	nodeCount: number;
}

function cleanProps(
	entry: ComponentManifestEntry,
	raw: unknown,
	path: string,
	state: WalkState,
): Record<string, PropValue> | null {
	const props: Record<string, PropValue> = {};
	const input = isPlainObject(raw) ? raw : {};
	if (raw !== undefined && !isPlainObject(raw)) {
		state.issues.push({ severity: 'error', path: `${path}.props`, message: 'props must be an object' });
	}

	for (const name of Object.keys(input)) {
		if (!entry.props || !Object.hasOwn(entry.props, name)) {
			state.issues.push({
				severity: 'warning',
				path: `${path}.props.${name}`,
				message: `unknown prop for "${entry.type}"; it will be ignored`,
			});
		}
	}

	for (const [name, def] of Object.entries(entry.props ?? {})) {
		const raw = Object.hasOwn(input, name) ? input[name] : undefined;
		const slot = cleanSlot(def, raw, `${path}.props.${name}`, state.issues);
		if (slot.drop) return null;
		if (slot.value !== undefined) props[name] = slot.value;
	}
	return props;
}

/**
 * A node's editor-only label, cleaned: plain text without control characters,
 * whitespace collapsed, at most `LIMITS.labelMaxLength` characters. '' for none.
 */
export function cleanNodeLabel(input: unknown): string {
	if (typeof input !== 'string') return '';
	return (
		input
			// Control characters, line separators, and bidi embedding/override/isolate controls (which can
			// make a name read differently from what it is).
			// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what's stripped
			.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, LIMITS.labelMaxLength)
			.trim()
	);
}

function cleanNodes(
	raw: unknown,
	path: string,
	depth: number,
	state: WalkState,
	parent?: ComponentManifestEntry,
): TapestryNode[] {
	if (!Array.isArray(raw)) {
		state.issues.push({ severity: 'error', path, message: 'must be an array of nodes' });
		return [];
	}
	if (depth > LIMITS.maxDepth) {
		state.issues.push({ severity: 'error', path, message: `nesting is deeper than ${LIMITS.maxDepth} levels` });
		return [];
	}

	const nodes: TapestryNode[] = [];
	raw.forEach((item, index) => {
		const nodePath = `${path}[${index}]`;
		if (state.nodeCount >= LIMITS.maxNodes) {
			if (state.nodeCount === LIMITS.maxNodes) {
				state.issues.push({
					severity: 'error',
					path: nodePath,
					message: `document has more than ${LIMITS.maxNodes} nodes; the rest are ignored`,
				});
				state.nodeCount++;
			}
			return;
		}
		if (!isPlainObject(item)) {
			state.issues.push({ severity: 'error', path: nodePath, message: 'node must be an object' });
			return;
		}
		const { id } = item;
		if (typeof id !== 'string' || !NODE_ID.test(id)) {
			state.issues.push({ severity: 'error', path: `${nodePath}.id`, message: `id must match ${NODE_ID}` });
			return;
		}
		if (state.ids.has(id)) {
			state.issues.push({ severity: 'error', path: `${nodePath}.id`, message: `duplicate id "${id}"` });
			return;
		}
		// A renamed component (`replaces`) takes over nodes stored with its old type.
		const type = typeof item.type === 'string' ? resolveType(state.manifest, item.type) : undefined;
		if (type === undefined) {
			state.issues.push({
				severity: 'error',
				path: `${nodePath}.type`,
				message: `unknown component type ${JSON.stringify(item.type)}`,
			});
			return;
		}
		if (type !== item.type) {
			state.issues.push({ severity: 'warning', path: `${nodePath}.type`, message: `"${item.type}" is now "${type}"` });
		}
		const entry = state.manifest[type] as ComponentManifestEntry;
		// Which area of the parent it's in. A slot the parent doesn't have: into the default
		// area if there is one, else the node is dropped.
		let slot: string | undefined;
		if (item.slot !== undefined) {
			if (!parent) {
				state.issues.push({
					severity: 'warning',
					path: `${nodePath}.slot`,
					message: 'top-level nodes have no slot; ignored',
				});
			} else if (typeof item.slot === 'string' && hasArea(parent, item.slot)) {
				slot = item.slot;
			} else if (parent.acceptsChildren) {
				state.issues.push({
					severity: 'warning',
					path: `${nodePath}.slot`,
					message: `"${parent.type}" has no slot ${JSON.stringify(item.slot)}; moved to its main area`,
				});
			} else {
				state.issues.push({
					severity: 'error',
					path: `${nodePath}.slot`,
					message: `"${parent.type}" has no slot ${JSON.stringify(item.slot)}`,
				});
				return;
			}
		} else if (parent && !parent.acceptsChildren) {
			state.issues.push({
				severity: 'error',
				path: nodePath,
				message: `"${parent.type}" only holds components in its slots (${Object.keys(parent.slots ?? {}).join(', ')})`,
			});
			return;
		}
		// Props saved with an older version of the component are upgraded first.
		const migration = migrateComponentProps(entry, item.props, item.version);
		if ('error' in migration) {
			state.issues.push({ severity: 'error', path: `${nodePath}.props`, message: migration.error });
		} else if (migration.warning) {
			state.issues.push({ severity: 'warning', path: `${nodePath}.version`, message: migration.warning });
		}
		const props = cleanProps(entry, migration.props, nodePath, state);
		if (!props) return;

		state.ids.add(id);
		state.nodeCount++;
		const label = cleanNodeLabel(item.label);
		if (item.label !== undefined && typeof item.label !== 'string') {
			state.issues.push({ severity: 'warning', path: `${nodePath}.label`, message: 'label must be text; ignored' });
		}
		let children: TapestryNode[] | undefined;
		if (item.children !== undefined) {
			if (hasChildAreas(entry)) {
				children = sortByArea(cleanNodes(item.children, `${nodePath}.children`, depth + 1, state, entry), entry);
			} else {
				state.issues.push({
					severity: 'error',
					path: `${nodePath}.children`,
					message: `"${type}" does not accept children; they will be ignored`,
				});
			}
		}
		// Canonical key order (id, type, version, label, slot, props, children): documents are compared as strings.
		nodes.push(
			canonicalNode({
				id,
				type,
				version: migration.version,
				...(label ? { label } : {}),
				...(slot !== undefined ? { slot } : {}),
				props,
				...(children ? { children } : {}),
			}),
		);
	});
	return nodes;
}

/**
 * Validate an already-parsed value as a Tapestry document.
 *
 * Never throws. Invalid nodes and props are dropped from the returned
 * `document` and reported in `issues`.
 */
export function validateDocument(input: unknown, manifest: ComponentManifest): ValidationResult {
	const state: WalkState = { manifest, issues: [], ids: new Set(), nodeCount: 0 };

	if (!isPlainObject(input)) {
		state.issues.push({ severity: 'error', path: '$', message: 'document must be a JSON object' });
		return { document: emptyDocument(), issues: state.issues, valid: false };
	}
	const format = migrateFormat(input);
	if ('error' in format) {
		state.issues.push({ severity: 'error', path: 'version', message: format.error });
		return { document: emptyDocument(), issues: state.issues, valid: false };
	}
	if (format.migrated) {
		state.issues.push({
			severity: 'warning',
			path: 'version',
			message: `upgraded from document version ${JSON.stringify(input.version)}`,
		});
	}

	const root = cleanNodes(format.document.root, 'root', 1, state);
	return {
		document: { version: 1, root },
		issues: state.issues,
		valid: !state.issues.some((i) => i.severity === 'error'),
	};
}

/**
 * Parse and validate stored page content. An empty string is treated as an
 * empty document, which is what a newly created StudioCMS page contains.
 */
export function parseDocument(content: string, manifest: ComponentManifest): ValidationResult {
	if (content.trim() === '') {
		return { document: emptyDocument(), issues: [], valid: true };
	}
	if (content.length > LIMITS.maxContentLength) {
		return {
			document: emptyDocument(),
			issues: [{ severity: 'error', path: '$', message: `content exceeds ${LIMITS.maxContentLength} characters` }],
			valid: false,
		};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch (error) {
		return {
			document: emptyDocument(),
			issues: [{ severity: 'error', path: '$', message: `invalid JSON: ${(error as Error).message}` }],
			valid: false,
		};
	}
	return validateDocument(parsed, manifest);
}
