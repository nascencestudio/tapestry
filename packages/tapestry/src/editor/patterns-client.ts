/**
 * The editor's side of patterns (saved sections, ADR 0028): the library's list,
 * saving the selected component, deleting, and inserting a fresh copy.
 */
import { signal } from '@preact/signals';
import type { PatternSummary } from '../patterns.js';
import { PATTERNS_ROUTE } from '../routes.js';
import type { TapestryNode } from '../types.js';
import type { EditorStore } from './store.js';
import { allIds, freshCopies, insertNodes, type Target } from './tree.js';

/** Saved patterns (null until loaded; [] if loading failed). */
export const patterns = signal<PatternSummary[] | null>(null);

const headers = { 'Content-Type': 'application/json' };

async function errorOf(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body.error === 'string') return body.error;
	} catch {}
	return `HTTP ${response.status}`;
}

export async function loadPatterns(): Promise<void> {
	try {
		const response = await fetch(PATTERNS_ROUTE, { credentials: 'same-origin' });
		const body = response.ok ? ((await response.json()) as { patterns?: PatternSummary[] }) : {};
		patterns.value = Array.isArray(body.patterns) ? body.patterns : [];
	} catch {
		patterns.value = [];
	}
}

/** Save nodes as a new pattern. Resolves to an error message, or null when saved. */
export async function savePattern(name: string, nodes: TapestryNode[]): Promise<string | null> {
	try {
		const response = await fetch(PATTERNS_ROUTE, {
			method: 'POST',
			credentials: 'same-origin',
			headers,
			body: JSON.stringify({ name, nodes }),
		});
		if (!response.ok) return await errorOf(response);
		await loadPatterns();
		return null;
	} catch {
		return 'Saving failed (network).';
	}
}

export async function deletePattern(id: string): Promise<string | null> {
	try {
		const response = await fetch(`${PATTERNS_ROUTE}?id=${encodeURIComponent(id)}`, {
			method: 'DELETE',
			credentials: 'same-origin',
		});
		if (!response.ok && response.status !== 404) return await errorOf(response);
		patterns.value = (patterns.value ?? []).filter((p) => p.id !== id);
		return null;
	} catch {
		return 'Deleting failed (network).';
	}
}

/** Insert a fresh copy of a pattern at `target` (fetched now, so it's current). */
export async function insertPattern(
	store: EditorStore,
	pattern: { id: string; name: string },
	target: Target,
	announce: (message: string) => void,
): Promise<boolean> {
	let nodes: unknown[] = [];
	try {
		const response = await fetch(`${PATTERNS_ROUTE}?id=${encodeURIComponent(pattern.id)}`, {
			credentials: 'same-origin',
		});
		if (!response.ok) {
			announce(`Couldn't insert “${pattern.name}”: ${await errorOf(response)}.`);
			return false;
		}
		const body = (await response.json()) as { pattern?: { nodes?: unknown } };
		nodes = Array.isArray(body.pattern?.nodes) ? body.pattern.nodes : [];
	} catch {
		announce(`Couldn't insert “${pattern.name}” (network).`);
		return false;
	}
	const doc = store.doc.peek();
	const copies = freshCopies(nodes, store.manifest, new Set(allIds(doc)));
	const first = copies?.[0];
	if (!copies || !first) {
		announce(`“${pattern.name}” has no components that are available here.`);
		return false;
	}
	if (store.commit(insertNodes(doc, store.manifest, copies, target), { select: first.id })) {
		announce(`Inserted “${pattern.name}”.`);
		return true;
	}
	announce(`“${pattern.name}” can't go there.`);
	return false;
}
