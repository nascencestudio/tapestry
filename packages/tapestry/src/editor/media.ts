/**
 * Editor access to @nascencestudio/medialibrary's picker (loaded on demand,
 * only when the library is installed), with a cache of item details for
 * previews. `Editor.astro` provides the loader through `mountEditor()`.
 */
import type { MediaItem, MediaKind } from '../types.js';

export interface PickerModule {
	openMediaPicker(options: { accept?: readonly MediaKind[]; title?: string }): Promise<MediaItem | null>;
	fetchMediaItem(id: string): Promise<MediaItem | null>;
}

let loader: (() => Promise<PickerModule>) | null = null;
let loaded: Promise<PickerModule> | null = null;
const items = new Map<string, Promise<MediaItem | null>>();

export function setMediaPickerLoader(load: (() => Promise<PickerModule>) | null): void {
	loader = load;
	loaded = null;
}

/** True when the media library is installed. */
export const mediaAvailable = () => loader !== null;

function picker(): Promise<PickerModule> | null {
	if (!loader) return null;
	loaded ??= loader();
	return loaded;
}

/** Open the picker; resolves with the chosen item, or null (cancelled or no library). */
export async function chooseMedia(accept?: readonly MediaKind[], title?: string): Promise<MediaItem | null> {
	const module = picker();
	if (!module) return null;
	const item = await (await module).openMediaPicker({ ...(accept ? { accept } : {}), ...(title ? { title } : {}) });
	if (item) items.set(item.id, Promise.resolve(item));
	return item;
}

/** Details of an item (cached), or null if it's gone or the library isn't installed. */
export function mediaItem(id: string): Promise<MediaItem | null> {
	const module = picker();
	if (!module) return Promise.resolve(null);
	let item = items.get(id);
	if (!item) {
		item = module.then((m) => m.fetchMediaItem(id)).catch(() => null);
		items.set(id, item);
	}
	return item;
}
