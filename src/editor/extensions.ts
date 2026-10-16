/**
 * Companion plugins' buttons in the editor bar (ADR 0040, 0042): SEO (@nascencestudio/tapestry-seo),
 * Menu (@nascencestudio/tapestry-menus). Each module is loaded on demand and owns its dialog and data;
 * Tapestry passes the page and the media picker loader. `Editor.astro` provides the list through
 * `mountEditor()`.
 */
import { mediaPickerLoader, type PickerModule } from './media.js';

export type CompanionOpen = (options: {
	pageId: string;
	loadPicker?: (() => Promise<PickerModule>) | null;
}) => Promise<void>;

export interface EditorExtension {
	id: string;
	label: string;
	title: string;
	load: () => Promise<CompanionOpen | undefined>;
}

let extensions: readonly EditorExtension[] = [];

export function setEditorExtensions(list: readonly EditorExtension[] | null | undefined): void {
	extensions = list ?? [];
}

export const editorExtensions = () => extensions;

/** Open a companion's dialog for a page; resolves when it closes. */
export async function openExtension(extension: EditorExtension, pageId: string): Promise<void> {
	const open = await extension.load();
	if (typeof open !== 'function')
		throw new Error(`${extension.label}: this version of the plugin has no editor dialog`);
	await open({ pageId, loadPicker: mediaPickerLoader() });
}
