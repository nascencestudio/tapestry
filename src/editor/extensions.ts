/**
 * Companion plugins in the page editor (ADR 0040, 0042): SEO (@nascencestudio/tapestry-seo) is a button
 * in the editor bar that opens its dialog; Menu settings (@nascencestudio/tapestry-menus) is a panel
 * under the settings panel. Each module is loaded on demand and owns its UI and data; Tapestry passes
 * the page and the media picker loader. `Editor.astro` provides the list through `mountEditor()`.
 */
import { mediaPickerLoader, type PickerModule } from './media.js';

export interface CompanionContext {
	pageId: string;
	loadPicker?: (() => Promise<PickerModule>) | null;
}

/** A button companion's function: opens its dialog; resolves when it closes. */
export type CompanionOpen = (options: CompanionContext) => Promise<void>;
/** A panel companion's function: fills `element`; returns a cleanup. */
export type CompanionMount = (element: HTMLElement, options: CompanionContext) => () => void;

export interface EditorExtension {
	id: string;
	kind: 'button' | 'panel';
	label: string;
	title: string;
	load: () => Promise<CompanionOpen | CompanionMount | undefined>;
}

let extensions: readonly EditorExtension[] = [];

export function setEditorExtensions(list: readonly EditorExtension[] | null | undefined): void {
	extensions = list ?? [];
}

export const editorExtensions = (kind: EditorExtension['kind']) => extensions.filter((e) => e.kind === kind);

const context = (pageId: string): CompanionContext => ({ pageId, loadPicker: mediaPickerLoader() });

/** Open a button companion's dialog for a page; resolves when it closes. */
export async function openExtension(extension: EditorExtension, pageId: string): Promise<void> {
	const open = await extension.load();
	if (typeof open !== 'function')
		throw new Error(`${extension.label}: this version of the plugin has no editor dialog`);
	await (open as CompanionOpen)(context(pageId));
}

/** Fill a panel companion's element for a page; resolves to its cleanup. */
export async function mountExtension(extension: EditorExtension, element: HTMLElement, pageId: string) {
	const mount = await extension.load();
	if (typeof mount !== 'function') throw new Error(`${extension.label}: this version of the plugin has no panel`);
	return (mount as CompanionMount)(element, context(pageId));
}
