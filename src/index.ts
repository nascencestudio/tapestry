import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { definePlugin } from 'studiocms/plugins';
import { toManifest } from './define.js';
import { NODE_ELEMENT, ROOT_ELEMENT } from './render.js';
import { DEFAULT_HISTORY_LIMIT } from './revisions.js';
import { PAGES_ROUTE, PATTERNS_ROUTE, TRANSLATIONS_ROUTE } from './routes.js';
import { type Language, parseLanguages } from './translations.js';
import type { ComponentDefinition } from './types.js';
import { islandWrapperSource, type MediaLibraryPaths, tapestryVitePlugin } from './vite.js';

export type { PageAccess, PermissionLevel, Viewer } from './access.js';
export { ANONYMOUS, hasPermission, isEditor, pageAccess, pagePath } from './access.js';
export { defineComponent, TapestryDefinitionError, toManifest } from './define.js';
export {
	decodeProps,
	encodeProps,
	escapeAttribute,
	NODE_ELEMENT,
	ROOT_ELEMENT,
	renderDocument,
	sanitizeOptions,
} from './render.js';
export type { HistoryEntry, PageStatus, StoredPage } from './revisions.js';
export {
	DEFAULT_HISTORY_LIMIT,
	discardDraft,
	documentFor,
	pageStatus,
	parseStoredPage,
	publish,
	restoreToDraft,
	saveDraft,
	serializeStoredPage,
	workingDocument,
} from './revisions.js';
export type { RenderNode, RichTextTag } from './richtext.js';
export {
	cleanRichText,
	DEFAULT_TOOLBAR,
	emptyRichText,
	isRichTextEmpty,
	RICH_TEXT_BUTTONS,
	RICH_TEXT_LIMITS,
	RICH_TEXT_TAGS,
	richTextFromPlain,
	richTextToPlain,
	toRenderTree,
} from './richtext.js';
export { CANVAS_PARAM, NODE_ATTR, ROOT_ATTR, TEXT_ATTR, TEXT_PROP_ATTR } from './runtime/canvas-mode.js';
export type { RichTextField, ToolbarSettings } from './toolbar-settings.js';
export {
	applyToolbarSettings,
	emptyToolbarSettings,
	parseToolbarSettings,
	richTextFields,
	settingsFromForm,
} from './toolbar-settings.js';
export type * from './types.js';
export type { ValidationIssue, ValidationResult } from './validate.js';
export {
	cleanRichTextProp,
	emptyDocument,
	isSafeUrl,
	LIMITS,
	parseDocument,
	validateDocument,
	validatePropValue,
} from './validate.js';

/** Identifier of the StudioCMS page type Tapestry registers. Stored on every Tapestry page. */
export const PAGE_TYPE = 'tapestry/canvas';

const PACKAGE_NAME = '@nascencestudio/tapestry';

/** Explicit so declaration emit stays small (StudioCMS's inferred plugin type is huge). */
export type TapestryPlugin = ReturnType<typeof definePlugin>;

export interface TapestryOptions {
	/** Components editors can place on pages. */
	components: ComponentDefinition[];
	/**
	 * Public URL pattern for pages, used by the editor's "View page" button.
	 * `{slug}` is replaced with the page slug; the `index` slug maps to the base.
	 * Defaults to `/{slug}`.
	 */
	pageUrlPattern?: string;
	/**
	 * How many earlier published versions each page keeps for restoring.
	 * Defaults to 5. See docs/decisions/0011-draft-publish-history.md.
	 */
	historyLimit?: number;
	/**
	 * Lowest StudioCMS role that may publish, schedule and unpublish Tapestry
	 * pages: `'editor'` (default: everyone who can edit), `'admin'` or `'owner'`.
	 * Others can still edit and save drafts; their saves never change the live
	 * version (enforced on the server). See docs/decisions/0022-publish-permission.md.
	 */
	publishPermission?: 'editor' | 'admin' | 'owner';
	/**
	 * Use @nascencestudio/medialibrary for `media` props and the rich text
	 * "Insert media" button. Default: on when the package is installed (it must
	 * also be registered as a StudioCMS plugin).
	 */
	mediaLibrary?: boolean;
	/**
	 * Languages pages can be translated into: `['en', 'fr']` or
	 * `[{ code: 'en', label: 'English' }, …]`. The first is the default (your
	 * existing pages). Each translation is its own page (slug `fr/<slug>`), linked
	 * to the original. Leave out for a single-language site.
	 * See docs/decisions/0032-translations.md.
	 */
	languages?: ReadonlyArray<string | { code: string; label?: string }>;
}

/** Locate @nascencestudio/medialibrary from the site's project root, or null. */
function findMediaLibrary(root: string): MediaLibraryPaths | null {
	try {
		const require = createRequire(join(root, 'package.json'));
		return {
			server: require.resolve('@nascencestudio/medialibrary/server'),
			picker: require.resolve('@nascencestudio/medialibrary/picker'),
			media: require.resolve('@nascencestudio/medialibrary/Media.astro'),
		};
	} catch {
		return null;
	}
}

function resolve(path: string): string {
	return new URL(path, import.meta.url).toString();
}

/**
 * The editor's browser dependencies, pre-bundled by Vite in dev. Without this,
 * Vite discovers them on the first editor visit and reloads the page
 * ("optimized dependencies changed"). `>` resolves them from this package,
 * since a site doesn't depend on them directly.
 */
const EDITOR_DEPS = [
	'preact',
	'preact/hooks',
	'preact/jsx-runtime',
	'@preact/signals',
	'@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter',
	'@atlaskit/pragmatic-drag-and-drop/utils/combine',
	'@atlaskit/pragmatic-drag-and-drop-hitbox/list-item/attach-instruction',
	'@atlaskit/pragmatic-drag-and-drop-hitbox/list-item/extract-instruction',
	'prosemirror-commands',
	'prosemirror-history',
	'prosemirror-keymap',
	'prosemirror-model',
	'prosemirror-schema-list',
	'prosemirror-state',
	'prosemirror-view',
].map((dep) => `${PACKAGE_NAME} > ${dep}`);

/** Route of the editors-only endpoint that renders unsaved documents for the canvas. */
export const RENDER_ROUTE = '/_tapestry/render';

/** Route of the admins-only endpoint that saves toolbar settings (ADR 0014). */
export const SETTINGS_ROUTE = '/_tapestry/settings';

/**
 * Entries for the StudioCMS `componentRegistry` option: Tapestry's two wrapper
 * elements (`<tapestry-root>` and `<tapestry-node>`). Spread them alongside any
 * registry entries of your own.
 *
 * (StudioCMS plugins cannot add registry entries themselves, so this one line
 * of configuration is required.)
 */
export function tapestryComponentRegistry(): Record<string, string> {
	return {
		[ROOT_ELEMENT]: fileURLToPath(resolve('./runtime/Root.astro')),
		[NODE_ELEMENT]: fileURLToPath(resolve('./runtime/Node.astro')),
	};
}

/**
 * Write the `.astro` wrappers that make interactive (`client`) components
 * islands, into `node_modules/.tapestry/islands/` of the site. Files are only
 * rewritten when their content changes, so dev doesn't reload in a loop.
 * Returns the wrapper path for each such component type.
 */
function writeIslandWrappers(definitions: readonly ComponentDefinition[], root: URL): Map<string, string> {
	const islands = new Map<string, string>();
	const interactive = definitions.filter((definition) => definition.client);
	if (interactive.length === 0) return islands;
	const dir = fileURLToPath(new URL('./node_modules/.tapestry/islands/', root));
	mkdirSync(dir, { recursive: true });
	for (const definition of interactive) {
		const file = join(dir, `${definition.type}.astro`);
		const source = islandWrapperSource(definition, fileURLToPath(new URL(definition.component, root)));
		let current: string | null = null;
		try {
			current = readFileSync(file, 'utf8');
		} catch {}
		if (current !== source) writeFileSync(file, source);
		islands.set(definition.type, file);
	}
	return islands;
}

/**
 * The Tapestry StudioCMS plugin. Registers the "Tapestry" page type with its
 * editor and renderer, and exposes the registered components to runtime code.
 *
 * @example
 * ```js
 * // studiocms.config.mjs
 * import { defineStudioCMSConfig } from 'studiocms/config';
 * import tapestry, { tapestryComponentRegistry } from '@nascencestudio/tapestry';
 * import { components } from './src/tapestry.config.mjs';
 *
 * export default defineStudioCMSConfig({
 *   componentRegistry: { ...tapestryComponentRegistry() },
 *   plugins: [tapestry({ components })],
 * });
 * ```
 */
export function tapestry(options: TapestryOptions): TapestryPlugin {
	// Validates uniqueness eagerly so config mistakes fail at startup.
	toManifest(options.components);
	if (options.publishPermission !== undefined && !['editor', 'admin', 'owner'].includes(options.publishPermission)) {
		throw new Error(`[tapestry] publishPermission must be 'editor', 'admin' or 'owner'.`);
	}
	let languages: Language[];
	try {
		languages = parseLanguages(options.languages);
	} catch (error) {
		throw new Error(`[tapestry] ${(error as Error).message}`);
	}

	return definePlugin({
		identifier: PACKAGE_NAME,
		name: 'Tapestry',
		hooks: {
			'studiocms:astro-config': ({ addIntegrations }) => {
				addIntegrations({
					name: PACKAGE_NAME,
					hooks: {
						'astro:config:setup': ({ config, updateConfig, injectRoute, addMiddleware }) => {
							injectRoute({
								pattern: RENDER_ROUTE,
								entrypoint: fileURLToPath(resolve('./runtime/Render.astro')),
								prerender: false,
							});
							// Where StudioCMS links a plugin with a settings page (Plugins → Tapestry).
							// 0.6.1 drops the slash after "plugins" (known issue #27), so serve both.
							// The literal default "/dashboard" outranks StudioCMS's own "/dashboard/[...pluginPage]"
							// route (static segments win); the [dashboard] variants cover a renamed dashboard.
							const settingsPatterns = ['/dashboard', '/[dashboard]'].flatMap((base) => [
								`${base}/plugins/${PACKAGE_NAME}`,
								`${base}/plugins${PACKAGE_NAME}`,
							]);
							for (const pattern of settingsPatterns) {
								injectRoute({
									pattern,
									entrypoint: fileURLToPath(resolve('./runtime/TapestrySettings.astro')),
									prerender: false,
								});
							}
							injectRoute({
								pattern: SETTINGS_ROUTE,
								entrypoint: fileURLToPath(resolve('./runtime/settings-endpoint.js')),
								prerender: false,
							});
							injectRoute({
								pattern: PAGES_ROUTE,
								entrypoint: fileURLToPath(resolve('./runtime/pages-endpoint.js')),
								prerender: false,
							});
							injectRoute({
								pattern: TRANSLATIONS_ROUTE,
								entrypoint: fileURLToPath(resolve('./runtime/translations-endpoint.js')),
								prerender: false,
							});
							injectRoute({
								pattern: PATTERNS_ROUTE,
								entrypoint: fileURLToPath(resolve('./runtime/patterns-endpoint.js')),
								prerender: false,
							});
							// Outermost, so it sees every JSON response (see middleware.ts).
							addMiddleware({ entrypoint: fileURLToPath(resolve('./runtime/middleware.js')), order: 'pre' });
							const islands = writeIslandWrappers(options.components, config.root);
							updateConfig({
								vite: {
									optimizeDeps: { include: EDITOR_DEPS },
									plugins: [
										tapestryVitePlugin(
											options.components,
											config.root,
											{
												pageUrlPattern: options.pageUrlPattern ?? '/{slug}',
												renderRoute: RENDER_ROUTE,
												historyLimit: Math.max(0, Math.floor(options.historyLimit ?? DEFAULT_HISTORY_LIMIT)),
												settingsRoute: SETTINGS_ROUTE,
												publishPermission: options.publishPermission ?? 'editor',
												languages,
											},
											{
												paths: options.mediaLibrary === false ? null : findMediaLibrary(fileURLToPath(config.root)),
												fallbackMedia: fileURLToPath(resolve('./runtime/MediaFallback.astro')),
											},
											islands,
										),
									],
								},
							});
						},
					},
				});
			},
			'studiocms:dashboard': ({ setDashboard }) => {
				// A settings page puts "Tapestry" in the dashboard's Plugins section. Its
				// link opens Tapestry's own page (TapestrySettings.astro, injected below),
				// so the generated fields stay empty.
				setDashboard({
					translations: { en: {} },
					settingsPage: { fields: [], endpoint: fileURLToPath(resolve('./runtime/settings-onsave.js')) },
				});
			},
			'studiocms:rendering': ({ setRendering }) => {
				setRendering({
					pageTypes: [
						{
							identifier: PAGE_TYPE,
							label: 'Tapestry (visual builder)',
							description: 'Build the page from registered components.',
							rendererComponent: resolve('./runtime/renderer.js'),
							pageContentComponent: resolve('./runtime/Editor.astro'),
						},
					],
				});
			},
		},
	});
}

export default tapestry;
