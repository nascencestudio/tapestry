import { cleanRichText, RICH_TEXT_BUTTONS } from './richtext.js';
import {
	CLIENT_DIRECTIVES,
	type ComponentDefinition,
	type ComponentManifest,
	MEDIA_KINDS,
	type PropDefinition,
} from './types.js';
import { cleanLinkValue, isSafeUrl, LIMITS, validatePropValue } from './validate.js';

/** Component types are kebab-case: lowercase letter first, then letters/digits, single hyphens. */
const COMPONENT_TYPE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/** Component files: Astro, or a framework component handled by the site's integration. */
const COMPONENT_FILE = /\.(astro|tsx|jsx|svelte|vue)$/;

/** Prop migration modules. */
const MIGRATIONS_FILE = /\.(m?js|ts)$/;

/** Thumbnail images the library can show. */
const THUMBNAIL_FILE = /\.(png|jpe?g|webp|avif|gif|svg)$/i;

/** Prop names must be plain JS identifiers (letters and digits). */
const PROP_NAME = /^[a-zA-Z][a-zA-Z0-9]*$/;

/**
 * Prop names that have special meaning on Astro components or in HTML and
 * would confuse editors or component authors if set from page content.
 */
const RESERVED_PROP_NAMES = new Set(['class', 'classList', 'style', 'id', 'slot', 'is', 'children', 'key', 'ref']);

export class TapestryDefinitionError extends Error {
	override name = 'TapestryDefinitionError';
}

function assertProp(type: string, name: string, prop: PropDefinition, parent?: string): void {
	const where = parent
		? `Component "${type}", prop "${parent}", field "${name}"`
		: `Component "${type}", prop "${name}"`;
	if (!PROP_NAME.test(name)) {
		throw new TapestryDefinitionError(`${where}: ${parent ? 'field' : 'prop'} names must match ${PROP_NAME}.`);
	}
	// Any name starting with "on" is rejected, even harmless ones like "online":
	// a component that spreads its props onto an element would otherwise turn
	// editor-supplied text into an inline event handler.
	if (RESERVED_PROP_NAMES.has(name) || /^on/i.test(name)) {
		throw new TapestryDefinitionError(
			`${where}: "${name}" is reserved (${[...RESERVED_PROP_NAMES].join(', ')} and names starting with "on" are not allowed).`,
		);
	}
	if (prop.type === 'select') {
		if (prop.options.length === 0) {
			throw new TapestryDefinitionError(`${where}: select props need at least one option.`);
		}
		if (prop.default !== undefined && !prop.options.some((o) => o.value === prop.default)) {
			throw new TapestryDefinitionError(`${where}: default "${prop.default}" is not one of the options.`);
		}
	}
	if (prop.type === 'richtext') {
		const toolbar = prop.toolbar ?? [];
		for (const button of toolbar) {
			if (!(RICH_TEXT_BUTTONS as readonly string[]).includes(button)) {
				throw new TapestryDefinitionError(
					`${where}: unknown toolbar button "${button}" (allowed: ${RICH_TEXT_BUTTONS.join(', ')}).`,
				);
			}
		}
		if (new Set(toolbar).size !== toolbar.length) {
			throw new TapestryDefinitionError(`${where}: toolbar lists a button more than once.`);
		}
		if (prop.default !== undefined) {
			const cleaned = cleanRichText(prop.default, {
				...(prop.toolbar ? { toolbar: prop.toolbar } : {}),
				...(prop.maxLength !== undefined ? { maxLength: prop.maxLength } : {}),
				isSafeUrl,
			});
			if (!cleaned.value || cleaned.changed) {
				throw new TapestryDefinitionError(
					`${where}: default ${cleaned.problem ?? 'uses formatting the toolbar does not allow'}.`,
				);
			}
		}
	}
	if (prop.type === 'media' || (prop.type === 'richtext' && prop.mediaAccept)) {
		const accept = prop.type === 'media' ? prop.accept : prop.mediaAccept;
		if (accept && (accept.length === 0 || accept.some((k) => !MEDIA_KINDS.includes(k)))) {
			throw new TapestryDefinitionError(`${where}: media kinds must be some of ${MEDIA_KINDS.join(', ')}.`);
		}
	}
	if (prop.type === 'link' && prop.default !== undefined && !cleanLinkValue(prop.default)) {
		throw new TapestryDefinitionError(
			`${where}: default must be a web address (relative, http, https, mailto or tel) or a link value.`,
		);
	}
	if (prop.type === 'number' && prop.min !== undefined && prop.max !== undefined && prop.min > prop.max) {
		throw new TapestryDefinitionError(`${where}: min is greater than max.`);
	}
	if (prop.type === 'object' || prop.type === 'list') {
		if (parent) throw new TapestryDefinitionError(`${where}: fields can't be objects or lists.`);
		const fields = Object.entries(prop.fields ?? {});
		if (fields.length === 0) throw new TapestryDefinitionError(`${where}: ${prop.type} props need at least one field.`);
		for (const [fieldName, field] of fields) assertProp(type, fieldName, field, name);
	}
	if (prop.type === 'list') {
		const { minItems = 0, maxItems = LIMITS.listDefaultMaxItems } = prop;
		if (!Number.isInteger(maxItems) || maxItems < 1 || maxItems > LIMITS.listMaxItems) {
			throw new TapestryDefinitionError(`${where}: maxItems must be a whole number from 1 to ${LIMITS.listMaxItems}.`);
		}
		if (!Number.isInteger(minItems) || minItems < 0 || minItems > maxItems) {
			throw new TapestryDefinitionError(`${where}: minItems must be a whole number from 0 to maxItems.`);
		}
	}
	if ((prop.type === 'object' || prop.type === 'list') && prop.default !== undefined) {
		const problem = validatePropValue(prop, prop.default);
		if (problem) throw new TapestryDefinitionError(`${where}: default ${problem}.`);
	}
}

/**
 * Declare a component that editors can place on Tapestry pages.
 *
 * Validates the definition eagerly so mistakes surface when the config loads,
 * not when an editor first tries to use the component.
 *
 * @example
 * ```ts
 * export const hero = defineComponent({
 *   type: 'hero',
 *   label: 'Hero',
 *   component: './src/components/tapestry/Hero.astro',
 *   props: {
 *     heading: { type: 'text', label: 'Heading', required: true },
 *   },
 * });
 * ```
 */
export function defineComponent<const T extends ComponentDefinition>(definition: T): T {
	const { type } = definition;
	if (!COMPONENT_TYPE.test(type)) {
		throw new TapestryDefinitionError(
			`Component type "${type}" must be kebab-case: lowercase letters and digits, starting with a letter, words separated by single hyphens (e.g. "hero" or "card-grid").`,
		);
	}
	if (!COMPONENT_FILE.test(definition.component)) {
		throw new TapestryDefinitionError(
			`Component "${type}": "component" must point to an .astro file or a framework component (.tsx, .jsx, .svelte, .vue).`,
		);
	}
	if (definition.client !== undefined) {
		if (!CLIENT_DIRECTIVES.includes(definition.client)) {
			throw new TapestryDefinitionError(
				`Component "${type}": "client" must be one of ${CLIENT_DIRECTIVES.join(', ')}.`,
			);
		}
		if (definition.component.endsWith('.astro')) {
			throw new TapestryDefinitionError(
				`Component "${type}": "client" is for framework components; an .astro component can use islands inside itself.`,
			);
		}
	}
	if (definition.permission !== undefined && !['editor', 'admin', 'owner'].includes(definition.permission)) {
		throw new TapestryDefinitionError(`Component "${type}": "permission" must be 'editor', 'admin' or 'owner'.`);
	}
	if (definition.version !== undefined && (!Number.isInteger(definition.version) || definition.version < 1)) {
		throw new TapestryDefinitionError(`Component "${type}": "version" must be a whole number of 1 or more.`);
	}
	if (definition.migrations !== undefined && !MIGRATIONS_FILE.test(definition.migrations)) {
		throw new TapestryDefinitionError(`Component "${type}": "migrations" must point to a .js, .mjs or .ts module.`);
	}
	for (const old of definition.replaces ?? []) {
		if (!COMPONENT_TYPE.test(old) || old === type) {
			throw new TapestryDefinitionError(
				`Component "${type}": "replaces" lists component types it used to have (kebab-case, not its own type); got "${old}".`,
			);
		}
	}
	if (definition.thumbnail !== undefined && !THUMBNAIL_FILE.test(definition.thumbnail)) {
		throw new TapestryDefinitionError(
			`Component "${type}": "thumbnail" must point to an image file (.png, .jpg, .jpeg, .webp, .avif, .gif or .svg).`,
		);
	}
	for (const [name, prop] of Object.entries(definition.props ?? {})) {
		assertProp(type, name, prop);
	}
	if (definition.slots !== undefined) {
		const slots = Object.entries(definition.slots);
		if (slots.length === 0) throw new TapestryDefinitionError(`Component "${type}": "slots" is empty; leave it out.`);
		for (const [name, slot] of slots) {
			if (!PROP_NAME.test(name) || name === 'default') {
				throw new TapestryDefinitionError(
					`Component "${type}", slot "${name}": slot names must match ${PROP_NAME} and not be "default" (that's the area acceptsChildren adds).`,
				);
			}
			if (typeof slot?.label !== 'string' || !slot.label.trim()) {
				throw new TapestryDefinitionError(`Component "${type}", slot "${name}": needs a label.`);
			}
		}
	}
	return definition;
}

/**
 * Strip build-time-only fields (file paths) so the manifest can be shipped to
 * the server runtime and the browser editor. Throws on duplicate types.
 */
export function toManifest(definitions: readonly ComponentDefinition[]): ComponentManifest {
	const manifest: ComponentManifest = {};
	for (const { component: _path, thumbnail: _thumbnail, migrations: _migrations, ...entry } of definitions) {
		if (Object.hasOwn(manifest, entry.type)) {
			throw new TapestryDefinitionError(`Component type "${entry.type}" is registered more than once.`);
		}
		manifest[entry.type] = entry;
	}
	// An old type name can only lead to one component, and can't be a registered type.
	const replaced = new Map<string, string>();
	for (const entry of Object.values(manifest)) {
		for (const old of entry.replaces ?? []) {
			if (Object.hasOwn(manifest, old)) {
				throw new TapestryDefinitionError(`Component "${entry.type}" replaces "${old}", which is still registered.`);
			}
			const other = replaced.get(old);
			if (other) {
				throw new TapestryDefinitionError(`Components "${other}" and "${entry.type}" both replace "${old}".`);
			}
			replaced.set(old, entry.type);
		}
	}
	return manifest;
}
