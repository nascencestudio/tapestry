/**
 * The SEO button's link to @nascencestudio/tapestry-seo (ADR 0040): its dialog is loaded on demand,
 * only when the package is installed. `Editor.astro` provides the loader through `mountEditor()`.
 * The dialog owns its data (it saves per-page settings at once, outside the page's draft).
 */
import { mediaPickerLoader, type PickerModule } from './media.js';

export interface SeoEditorModule {
	openSeoEditor(options: { pageId: string; loadPicker?: (() => Promise<PickerModule>) | null }): Promise<void>;
}

let loader: (() => Promise<SeoEditorModule>) | null = null;

export function setSeoEditorLoader(load: (() => Promise<SeoEditorModule>) | null): void {
	loader = load;
}

/** True when tapestry-seo is installed. */
export const seoAvailable = () => loader !== null;

/** Open the SEO dialog for a page; resolves when it closes (immediately without tapestry-seo). */
export async function openSeo(pageId: string): Promise<void> {
	if (!loader) return;
	await (await loader()).openSeoEditor({ pageId, loadPicker: mediaPickerLoader() });
}
