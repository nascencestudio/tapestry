/**
 * Pictures of components in the library: the developer's thumbnails (the
 * `thumbnail` option) and live previews: the component rendered with the
 * values a new one starts with, shown in a small sandboxed frame (no scripts)
 * with the site's CSS as the canvas page loaded it.
 */
import { signal } from '@preact/signals';
import type { ComponentManifest } from '../types.js';
import { createNode } from './tree.js';

/** Thumbnail URLs by component type. */
export const thumbnails = signal<Record<string, string>>({});

let renderRoute = '/_tapestry/render';

export function configurePreviews(options: { thumbnails?: Record<string, string>; renderRoute?: string }) {
	thumbnails.value = options.thumbnails ?? {};
	if (options.renderRoute) renderRoute = options.renderRoute;
}

const cache = new Map<string, Promise<string | null>>();

/** The component's markup with its starting values (from the render endpoint), or null. Cached per type. */
export function previewMarkup(manifest: ComponentManifest, type: string): Promise<string | null> {
	let pending = cache.get(type);
	if (!pending) {
		pending = render(manifest, type);
		cache.set(type, pending);
		// A failure isn't cached: the next hover tries again.
		pending.then((markup) => markup === null && cache.delete(type));
	}
	return pending;
}

async function render(manifest: ComponentManifest, type: string): Promise<string | null> {
	const node = createNode(manifest, type, new Set());
	if (!node) return null;
	try {
		const response = await fetch(renderRoute, {
			method: 'POST',
			credentials: 'same-origin',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ version: 1, root: [node] }),
		});
		if (!response.ok) return null;
		const html = await response.text();
		const root = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-tapestry-root]');
		if (!root) return null;
		// Markup only (like the canvas): no page-level tags, and no editing drop zones.
		for (const el of root.querySelectorAll('style, link, script, meta, title, noscript, tapestry-canvas-drop'))
			el.remove();
		return root.innerHTML;
	} catch {
		return null;
	}
}

/** The canvas page's stylesheets and root classes, to style a preview like the site. Null without a canvas. */
export function siteStyles(): { head: string; htmlClass: string; bodyClass: string } | null {
	const doc = document.querySelector<HTMLIFrameElement>('[data-tapestry-canvas]')?.contentDocument;
	if (!doc?.head || !doc.body) return null;
	const sheets = Array.from(doc.head.querySelectorAll('link[rel~="stylesheet"], style'))
		// Not the canvas's own overlay styles.
		.filter((el) => !el.id.startsWith('tapestry-canvas'))
		.map((el) => el.outerHTML)
		.join('');
	return { head: sheets, htmlClass: doc.documentElement.className, bodyClass: doc.body.className };
}

/** A complete document for a preview frame. */
export function previewDocument(markup: string, styles: NonNullable<ReturnType<typeof siteStyles>>): string {
	const base = `<base href="${location.origin}/">`;
	const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
	return `<!doctype html><html class="${attr(styles.htmlClass)}"><head><meta charset="utf-8">${base}${styles.head}<style>html,body{margin:0;background:transparent;overflow:hidden}body{padding:24px}</style></head><body class="${attr(styles.bodyClass)}">${markup}</body></html>`;
}
