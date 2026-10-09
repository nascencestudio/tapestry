/**
 * Reusable patterns (saved sections): a named copy of one or more components,
 * with everything inside them, that editors insert into any page. Inserting
 * makes a fresh copy (new ids); later edits to the pattern don't change pages
 * that used it. See docs/decisions/0028-patterns.md.
 *
 * Pure functions: building, cleaning and summarizing patterns. Storage lives in
 * runtime/patterns-store.ts, the HTTP API in runtime/patterns-endpoint.ts.
 */
import type { ComponentManifest, TapestryNode } from './types.js';
import { cleanNodeLabel, LIMITS, validateDocument } from './validate.js';

export const PATTERN_LIMITS = {
	/** Longest pattern name, in characters. */
	nameMaxLength: LIMITS.labelMaxLength,
	/** Most patterns a site can have. */
	maxPatterns: 100,
	/** Largest pattern, as JSON characters. */
	maxContentLength: 100_000,
} as const;

/** A stored pattern. */
export interface Pattern {
	id: string;
	name: string;
	/** The saved components (validated; ids as they were when saved). */
	nodes: TapestryNode[];
	createdAt: string;
	/** User id of who saved it (for "only the author or an admin can delete"). */
	createdBy: string | null;
	createdByName: string | null;
}

/** What the editor's library lists (no components: those are fetched when inserting). */
export interface PatternSummary {
	id: string;
	name: string;
	/** "Section with 4 components". */
	description: string;
	createdAt: string;
	createdByName: string | null;
	/** Whether the current user may delete it. */
	canDelete: boolean;
}

/** Pattern ids: `pt_` + 16 lowercase base-36 characters. */
export const PATTERN_ID = /^pt_[a-z0-9]{16}$/;

/** A new random pattern id (`random` returns bytes; crypto in production). */
export function newPatternId(
	random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
	const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
	return `pt_${Array.from(random(16), (b) => alphabet[b % 36]).join('')}`;
}

/** A pattern name: plain text, control characters removed, whitespace collapsed, ≤ 60 characters. '' if empty. */
export function cleanPatternName(input: unknown): string {
	// Same rules (and length) as a node's editor-only name.
	return cleanNodeLabel(input);
}

/** Components cleaned against the manifest (unknown components and bad props dropped), like stored pages. */
export function cleanPatternNodes(nodes: unknown, manifest: ComponentManifest): TapestryNode[] {
	if (!Array.isArray(nodes)) return [];
	// Top-level: a slot from where it was saved doesn't apply.
	return validateDocument({ version: 1, root: nodes }, manifest).document.root;
}

const countNodes = (nodes: TapestryNode[]): number =>
	nodes.reduce((sum, node) => sum + 1 + countNodes(node.children ?? []), 0);

/** "Section with 3 components inside" style description. */
export function describePattern(nodes: TapestryNode[], manifest: ComponentManifest): string {
	const first = nodes[0];
	if (!first) return 'Empty';
	const label = manifest[first.type]?.label ?? first.type;
	const inside = countNodes(nodes) - 1;
	if (nodes.length > 1) return `${nodes.length} components`;
	return inside > 0 ? `${label} with ${inside} component${inside === 1 ? '' : 's'} inside` : label;
}

export type PatternInputResult = { pattern: Pattern } | { error: string; status: number };

/** A new pattern from an editor's request, or why it can't be saved. */
export function patternFromInput(
	input: unknown,
	manifest: ComponentManifest,
	author: { id: string | null; name: string | null },
	now: Date,
	id = newPatternId(),
): PatternInputResult {
	if (typeof input !== 'object' || input === null) return { error: 'Expected a JSON object', status: 400 };
	const { name: rawName, nodes: rawNodes } = input as { name?: unknown; nodes?: unknown };
	const name = cleanPatternName(rawName);
	if (!name) return { error: 'A pattern needs a name', status: 400 };
	const nodes = cleanPatternNodes(rawNodes, manifest);
	if (nodes.length === 0) return { error: 'Nothing to save: no valid components', status: 400 };
	if (JSON.stringify(nodes).length > PATTERN_LIMITS.maxContentLength) {
		return { error: 'This section is too large to save as a pattern', status: 413 };
	}
	return {
		pattern: { id, name, nodes, createdAt: now.toISOString(), createdBy: author.id, createdByName: author.name },
	};
}

/** A pattern read from storage (cleaned against the current manifest), or null if it's unusable. */
export function parseStoredPattern(raw: unknown, manifest: ComponentManifest): Pattern | null {
	if (typeof raw !== 'object' || raw === null) return null;
	const value = raw as Record<string, unknown>;
	if (typeof value.id !== 'string' || !PATTERN_ID.test(value.id)) return null;
	const name = cleanPatternName(value.name);
	if (!name) return null;
	return {
		id: value.id,
		name,
		nodes: cleanPatternNodes(value.nodes, manifest),
		createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
		createdBy: typeof value.createdBy === 'string' ? value.createdBy : null,
		createdByName: typeof value.createdByName === 'string' ? cleanPatternName(value.createdByName) || null : null,
	};
}

/** The summary the library shows, for a viewer (`canDelete`: the author or an admin). */
export function summarizePattern(
	pattern: Pattern,
	manifest: ComponentManifest,
	viewer: { id: string | null; isAdmin: boolean },
): PatternSummary {
	return {
		id: pattern.id,
		name: pattern.name,
		description: describePattern(pattern.nodes, manifest),
		createdAt: pattern.createdAt,
		createdByName: pattern.createdByName,
		canDelete: viewer.isAdmin || (pattern.createdBy !== null && pattern.createdBy === viewer.id),
	};
}
