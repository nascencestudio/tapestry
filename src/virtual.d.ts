declare module 'virtual:tapestry/manifest' {
	const manifest: import('./types.js').ComponentManifest;
	export default manifest;
}

declare module 'virtual:tapestry/components' {
	/** Registered Astro components keyed by Tapestry component type. */
	// biome-ignore lint/suspicious/noExplicitAny: Astro components have no exported public type
	const components: Record<string, (props: any) => any>;
	export default components;
}

declare module 'virtual:tapestry/config' {
	const config: import('./vite.js').RuntimeConfig;
	export default config;
}

declare module 'virtual:tapestry/media' {
	/** True when @nascencestudio/medialibrary is installed and in use. */
	export const enabled: boolean;
	export function getMediaItems(ids: readonly unknown[]): Promise<Map<string, import('./types.js').MediaItem>>;
	// biome-ignore lint/suspicious/noExplicitAny: Astro components have no exported public type
	export const Media: (props: any) => any;
}

declare module 'virtual:tapestry/media-client' {
	export const enabled: boolean;
	export const loadPicker: null | (() => Promise<import('./editor/media.js').PickerModule>);
}

declare module 'virtual:tapestry/thumbnails' {
	/** Thumbnail image URLs by component type (only components that set `thumbnail`). */
	const thumbnails: Record<string, string>;
	export default thumbnails;
}
