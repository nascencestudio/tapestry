/**
 * Loads the rich text editor (ProseMirror, ~67 KB gzipped) as its own chunk,
 * so the editor's first load stays small. Used by the settings panel and by
 * inline editing on the canvas.
 */
export type RichTextModule = typeof import('./RichTextField.js');

let loaded: RichTextModule | null = null;
let loading: Promise<RichTextModule> | null = null;

/** The module if it has already loaded (no waiting). */
export function richTextModule(): RichTextModule | null {
	return loaded;
}

export function preloadRichText(): Promise<RichTextModule> {
	loading ??= import('./RichTextField.js').then((mod) => {
		loaded = mod;
		return mod;
	});
	return loading;
}
