import { fileURLToPath } from 'node:url';
import { toManifest } from './define.js';
import type { Language } from './translations.js';
import type { ComponentDefinition } from './types.js';

export const MANIFEST_MODULE_ID = 'virtual:tapestry/manifest';
export const COMPONENTS_MODULE_ID = 'virtual:tapestry/components';
export const CONFIG_MODULE_ID = 'virtual:tapestry/config';
export const MEDIA_MODULE_ID = 'virtual:tapestry/media';
export const MEDIA_CLIENT_MODULE_ID = 'virtual:tapestry/media-client';
export const THUMBNAILS_MODULE_ID = 'virtual:tapestry/thumbnails';

/** Where @nascencestudio/medialibrary's entry points are, when it's installed. */
export interface MediaLibraryPaths {
	server: string;
	picker: string;
	media: string;
}

/**
 * Source of the media modules. With the media library: its server lookup, its
 * `Media.astro` and (lazily) its picker. Without it: empty stand-ins, so
 * `media` props resolve to null and the editor explains what's missing.
 */
export function mediaModuleSources(paths: MediaLibraryPaths | null, fallbackMedia: string) {
	if (!paths) {
		return {
			server: `export const enabled = false;\nexport async function getMediaItems() { return new Map(); }\nexport { default as Media } from ${JSON.stringify(fallbackMedia)};\n`,
			client: 'export const enabled = false;\nexport const loadPicker = null;\n',
		};
	}
	return {
		server: `export const enabled = true;\nexport { getMediaItems } from ${JSON.stringify(paths.server)};\nexport { default as Media } from ${JSON.stringify(paths.media)};\n`,
		client: `export const enabled = true;\nexport const loadPicker = () => import(${JSON.stringify(paths.picker)});\n`,
	};
}

/** Browser-safe runtime settings exposed as `virtual:tapestry/config`. */
export interface RuntimeConfig {
	/** Public URL pattern for pages, e.g. `/{slug}`. See `pagePath()`. */
	pageUrlPattern: string;
	/** Route of the editors-only render endpoint used by the canvas. */
	renderRoute: string;
	/** How many earlier published versions each page keeps. */
	historyLimit: number;
	/** Route of the admins-only endpoint that saves toolbar settings. */
	settingsRoute: string;
	/** Lowest StudioCMS role that may publish (and schedule) Tapestry pages. */
	publishPermission: 'editor' | 'admin' | 'owner';
	/** Languages pages can be translated into; the first is the default. Empty: one language. */
	languages: Language[];
}

export interface MediaSetup {
	paths: MediaLibraryPaths | null;
	/** Component rendered for media when the library isn't installed (renders nothing). */
	fallbackMedia: string;
}

/**
 * Generate the source of `virtual:tapestry/components`: a static import of
 * every registered `.astro` file, exported as a map keyed by component type.
 *
 * @param definitions Registered components.
 * @param root The Astro project root, used to resolve relative component paths.
 */
export function componentsModuleSource(
	definitions: readonly ComponentDefinition[],
	root: URL,
	/** Generated island wrappers (`islandWrapperSource()`) by component type, used instead of the component. */
	islands: ReadonlyMap<string, string> = new Map(),
): string {
	const imports: string[] = [];
	const entries: string[] = [];
	definitions.forEach((definition, index) => {
		const file = islands.get(definition.type) ?? fileURLToPath(new URL(definition.component, root));
		imports.push(`import C${index} from ${JSON.stringify(file)};`);
		entries.push(`${JSON.stringify(definition.type)}: C${index}`);
	});
	return `${imports.join('\n')}\nexport default { ${entries.join(', ')} };\n`;
}

/**
 * Generate the source of `virtual:tapestry/manifest`: the manifest as JSON, plus
 * each component's prop migrations (`migrate`), imported from its `migrations`
 * module (functions can't be JSON). Used on the server and in the editor.
 */
export function manifestModuleSource(definitions: readonly ComponentDefinition[], root: URL): string {
	const imports: string[] = [];
	const assignments: string[] = [];
	definitions.forEach((definition, index) => {
		if (!definition.migrations) return;
		const file = fileURLToPath(new URL(definition.migrations, root));
		imports.push(`import M${index} from ${JSON.stringify(file)};`);
		assignments.push(`manifest[${JSON.stringify(definition.type)}].migrate = M${index};`);
	});
	return [
		...imports,
		`const manifest = ${JSON.stringify(toManifest(definitions))};`,
		...assignments,
		'export default manifest;',
		'',
	].join('\n');
}

/**
 * Source of the `.astro` wrapper that makes a framework component an island:
 * Astro only hydrates components imported statically in an `.astro` file with
 * a literal `client:*` directive, so `Node.astro` (which picks components at
 * render time) renders this wrapper instead. Children and named slots pass
 * through. See docs/decisions/0030-islands.md.
 */
export function islandWrapperSource(definition: ComponentDefinition, componentFile: string): string {
	if (!definition.client) throw new Error(`"${definition.type}" has no client directive`);
	const slots = [
		...(definition.acceptsChildren ? ['<slot />'] : []),
		...Object.keys(definition.slots ?? {}).map((name) => `<slot name="${name}" slot="${name}" />`),
	];
	return [
		'---',
		`// Generated by Tapestry for "${definition.type}" (client:${definition.client}). Don't edit: it's rewritten on start.`,
		`import Component from ${JSON.stringify(componentFile)};`,
		'---',
		slots.length > 0
			? `<Component client:${definition.client} {...Astro.props}>${slots.join('')}</Component>`
			: `<Component client:${definition.client} {...Astro.props} />`,
		'',
	].join('\n');
}

/**
 * Generate the source of `virtual:tapestry/thumbnails`: the URL of each
 * component's thumbnail image (bundled by Vite), keyed by component type.
 */
export function thumbnailsModuleSource(definitions: readonly ComponentDefinition[], root: URL): string {
	const imports: string[] = [];
	const entries: string[] = [];
	definitions.forEach((definition, index) => {
		if (!definition.thumbnail) return;
		const file = fileURLToPath(new URL(definition.thumbnail, root));
		imports.push(`import T${index} from ${JSON.stringify(`${file}?url`)};`);
		entries.push(`${JSON.stringify(definition.type)}: T${index}`);
	});
	return `${imports.join('\n')}\nexport default { ${entries.join(', ')} };\n`;
}

/**
 * Vite plugin that exposes Tapestry's build-time configuration to runtime code:
 *
 * - `virtual:tapestry/manifest`: the component manifest (no file paths), used
 *   by the renderer and the dashboard editor.
 * - `virtual:tapestry/components`: the Astro components, used by `Node.astro`.
 * - `virtual:tapestry/config`: browser-safe runtime settings (e.g. the page URL pattern).
 *
 * Typed structurally so this package does not need `vite` as a dependency.
 */
export function tapestryVitePlugin(
	definitions: readonly ComponentDefinition[],
	root: URL,
	config: RuntimeConfig = {
		pageUrlPattern: '/{slug}',
		renderRoute: '/_tapestry/render',
		historyLimit: 5,
		settingsRoute: '/_tapestry/settings',
		publishPermission: 'editor',
		languages: [],
	},
	media: MediaSetup = { paths: null, fallbackMedia: '' },
	islands: ReadonlyMap<string, string> = new Map(),
) {
	const mediaSources = mediaModuleSources(media.paths, media.fallbackMedia);
	const modules = new Map([
		[`\0${MANIFEST_MODULE_ID}`, manifestModuleSource(definitions, root)],
		[`\0${COMPONENTS_MODULE_ID}`, componentsModuleSource(definitions, root, islands)],
		[`\0${CONFIG_MODULE_ID}`, `export default ${JSON.stringify(config)};`],
		[`\0${MEDIA_MODULE_ID}`, mediaSources.server],
		[`\0${MEDIA_CLIENT_MODULE_ID}`, mediaSources.client],
		[`\0${THUMBNAILS_MODULE_ID}`, thumbnailsModuleSource(definitions, root)],
	]);
	return {
		name: 'tapestry:virtual-modules',
		resolveId(id: string) {
			return modules.has(`\0${id}`) ? `\0${id}` : undefined;
		},
		load(id: string) {
			return modules.get(id);
		},
	};
}
