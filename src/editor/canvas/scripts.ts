/**
 * Running component scripts on the canvas after a live update. The canvas
 * swaps in markup from the render endpoint, and swapped-in `<script>`
 * elements don't run, so a component added while editing (an island, or an
 * Astro component with a `<script>`) would stay inert. Instead, each script in
 * a render response that the canvas page hasn't run yet is run once: Astro's
 * island bootstrap (then new `<astro-island>` elements hydrate by themselves)
 * and component scripts by URL. Scripts already run are never repeated, so
 * component scripts should act on elements as they appear (custom elements,
 * as Astro recommends). See docs/decisions/0030-islands.md.
 */

const EXECUTABLE = new Set(['', 'module', 'text/javascript', 'application/javascript']);

/** Identity of a script: its absolute URL, or its inline source. Null for non-JS (e.g. JSON data). */
export function scriptKey(script: HTMLScriptElement, base: string): string | null {
	const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
	if (!EXECUTABLE.has(type)) return null;
	const src = script.getAttribute('src');
	if (src) {
		try {
			return `src:${type === 'module' ? 'module' : 'classic'}:${new URL(src, base).href}`;
		} catch {
			return null;
		}
	}
	const text = script.textContent ?? '';
	return text.trim() ? `inline:${type === 'module' ? 'module' : 'classic'}:${text}` : null;
}

/** Keys of the scripts a document has (the canvas page's own, as loaded). */
export function scriptKeys(doc: Document): Set<string> {
	const keys = new Set<string>();
	for (const script of doc.querySelectorAll('script')) {
		const key = scriptKey(script, doc.baseURI);
		if (key) keys.add(key);
	}
	return keys;
}

/** Scripts in a render response that haven't run in the canvas yet, in document order. */
export function pendingScripts(response: Document, base: string, ran: ReadonlySet<string>): HTMLScriptElement[] {
	const seen = new Set<string>();
	return Array.from(response.querySelectorAll('script')).filter((script) => {
		const key = scriptKey(script, base);
		if (!key || ran.has(key) || seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Run scripts in the canvas document (appended to its head) and remember them. */
export function runScripts(doc: Document, scripts: HTMLScriptElement[], ran: Set<string>): void {
	for (const original of scripts) {
		const key = scriptKey(original, doc.baseURI);
		if (!key || ran.has(key)) continue;
		ran.add(key);
		const script = doc.createElement('script');
		for (const { name, value } of Array.from(original.attributes)) script.setAttribute(name, value);
		if (!original.getAttribute('src')) script.textContent = original.textContent;
		doc.head.append(script);
	}
}
